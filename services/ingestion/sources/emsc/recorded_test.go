package emsc_test

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"os"
	"testing"
	"time"

	"antisismo.app/ingestion/normalize"
	"antisismo.app/ingestion/pipeline"
	"antisismo.app/ingestion/sources/emsc"
)

// testdata/recorded-2026-10-01.json: 3 mensajes reales de wss://www.seismicportal.eu/standing_order/websocket
// grabados el 2026-10-01 01:29–01:43 UTC. El servidor envía "data" con JSON indentado (varias líneas),
// por eso el archivo es un flujo JSON y no JSONL.
func recorded(t *testing.T) [][]byte {
	t.Helper()
	b, err := os.ReadFile("testdata/recorded-2026-10-01.json")
	if err != nil {
		t.Fatal(err)
	}
	dec := json.NewDecoder(bytes.NewReader(b))
	var out [][]byte
	for {
		var raw json.RawMessage
		if err := dec.Decode(&raw); errors.Is(err, io.EOF) {
			return out
		} else if err != nil {
			t.Fatal(err)
		}
		out = append(out, raw)
	}
}

func TestRecordedLiveMessagesParse(t *testing.T) {
	msgs := recorded(t)
	if len(msgs) != 3 {
		t.Fatalf("messages=%d", len(msgs))
	}
	recv := time.Date(2026, 10, 1, 1, 44, 0, 0, time.UTC).UnixMilli()
	type want struct {
		unid          string
		mag           float64
		magType       string
		lat, lon, dkm float64
		timeMs, updMs int64
	}
	wants := []want{
		{"20261001_0000024", 5.3, "mb", 36.1597, 68.9228, 29.0,
			time.Date(2026, 10, 1, 1, 29, 19, 400e6, time.UTC).UnixMilli(), time.Date(2026, 10, 1, 1, 39, 56, 548e6, time.UTC).UnixMilli()},
		{"20261001_0000025", 3.2, "m", 36.0, 139.5, 50.0,
			time.Date(2026, 10, 1, 1, 32, 30, 0, time.UTC).UnixMilli(), time.Date(2026, 10, 1, 1, 42, 20, 823e6, time.UTC).UnixMilli()},
		{"20261001_0000024", 5.2, "mb", 36.0991, 68.7818, 49.6,
			time.Date(2026, 10, 1, 1, 29, 20, 694e6, time.UTC).UnixMilli(), time.Date(2026, 10, 1, 1, 43, 18, 60e6, time.UTC).UnixMilli()},
	}
	for i, m := range msgs {
		o, err := emsc.ParseMessage(m, recv)
		if err != nil {
			t.Fatalf("msg %d: %v", i, err)
		}
		w, e := wants[i], o.Event
		if o.Source != "emsc" || o.SourceID != w.unid || e.ID != normalize.EventID("emsc", w.unid) {
			t.Errorf("msg %d ids: %+v", i, o)
		}
		// GeoJSON trae profundidad negativa en coordinates; el contrato usa la positiva de properties.
		if e.Magnitude != w.mag || e.MagType != w.magType || e.Lat != w.lat || e.Lon != w.lon || e.DepthKm != w.dkm {
			t.Errorf("msg %d values: %+v", i, e)
		}
		if e.TimeUTCms != w.timeMs || o.SourceUpdatedMs != w.updMs || e.ReceivedAtMs != recv {
			t.Errorf("msg %d times: time=%d upd=%d", i, e.TimeUTCms, o.SourceUpdatedMs)
		}
		if err := e.Validate(); err != nil {
			t.Errorf("msg %d contract: %v", i, err)
		}
	}
}

func TestRecordedUpdateBecomesRevision(t *testing.T) {
	p := pipeline.New(normalize.DedupConfig{WindowMs: 16_000, RadiusKm: 100, MaxDeltaMag: 1.5}, time.Hour)
	recv := time.Date(2026, 10, 1, 1, 44, 0, 0, time.UTC).UnixMilli()
	var kinds []pipeline.Kind
	for _, m := range recorded(t) {
		o, err := emsc.ParseMessage(m, recv)
		if err != nil {
			t.Fatal(err)
		}
		_, k := p.Ingest(o)
		kinds = append(kinds, k)
	}
	// Hindu Kush (nuevo) · Honshu (nuevo) · Hindu Kush reubicado 14 km y M5.3→5.2 (revisión material).
	if kinds[0] != pipeline.KindNew || kinds[1] != pipeline.KindNew || kinds[2] != pipeline.KindRevision {
		t.Fatalf("kinds=%v", kinds)
	}
	h := p.History(normalize.EventID("emsc", "20261001_0000024"))
	if len(h) != 2 || h[1].Seq != 1 || h[1].Magnitude != 5.2 {
		t.Fatalf("history: %+v", h)
	}
}
