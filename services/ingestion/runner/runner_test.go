package runner

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"antisismo.app/ingestion/health"
	"antisismo.app/ingestion/normalize"
	"antisismo.app/ingestion/pipeline"
	"antisismo.app/ingestion/regioncfg"
	"antisismo.app/ingestion/sources"
	"antisismo.app/ingestion/sources/emsc"
	"antisismo.app/ingestion/sources/usgs"
	"antisismo.app/proto/contract"
)

const t0 = int64(1790627527000) // 2026-09-28T20:32:07Z (errata §3#1)

func obs(src, id string, mag, lat, lon float64, dt int64) sources.Observation {
	return sources.Observation{Source: src, SourceID: id, SourceUpdatedMs: t0 + dt, Event: contract.Event{
		ID: normalize.EventID(src, id), SourceIDs: map[string]string{src: id}, Type: "EARTHQUAKE",
		Magnitude: mag, MagType: "mw", TimeUTCms: t0 + dt, ReceivedAtMs: t0 + dt + 2000,
		Lon: lon, Lat: lat, DepthKm: 10, Place: "Zona de prueba", SolutionStatus: "automatic",
	}}
}

// provider de prueba: emite una lista y luego se queda vivo (o falla si failErr != nil).
type fake struct {
	name    string
	items   []sources.Observation
	failErr error
	panics  atomic.Int32
	runs    atomic.Int32
	doPanic bool
}

func (f *fake) Name() string  { return f.name }
func (f *fake) Enabled() bool { return true }
func (f *fake) Run(ctx context.Context, out chan<- sources.Observation) error {
	if f.runs.Add(1) == 1 && f.doPanic {
		f.panics.Add(1)
		panic("connector bug")
	}
	if f.failErr != nil {
		return f.failErr
	}
	for _, o := range f.items {
		select {
		case out <- o:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	<-ctx.Done()
	return ctx.Err()
}

func start(t *testing.T, provs ...sources.AlertSourceProvider) (chan Emitted, *health.Registry, *bytes.Buffer, context.CancelFunc) {
	t.Helper()
	var logs bytes.Buffer
	log := slog.New(slog.NewJSONHandler(&logs, nil))
	h := health.NewRegistry(50*time.Millisecond, log, nil)
	h.Register("usgs", true)
	h.Register("emsc", false)
	out := make(chan Emitted, 16)
	r := &Runner{
		Pipeline: pipeline.New(normalize.DefaultDedup, 7*24*time.Hour), Health: h, Providers: provs,
		Out: out, Log: log, Watchdog: 10 * time.Millisecond, RestartDelay: 5 * time.Millisecond,
	}
	ctx, cancel := context.WithCancel(context.Background())
	go func() { _ = r.Run(ctx) }()
	return out, h, &logs, cancel
}

func recv(t *testing.T, ch chan Emitted) Emitted {
	t.Helper()
	select {
	case e := <-ch:
		return e
	case <-time.After(2 * time.Second):
		t.Fatal("timeout waiting for emission")
	}
	return Emitted{}
}

func TestCrossSourceDuplicateEmitsOnce(t *testing.T) {
	u := &fake{name: "usgs", items: []sources.Observation{obs("usgs", "us1", 6.4, 18.50, -69.90, 0)}}
	e := &fake{name: "emsc", items: []sources.Observation{obs("emsc", "e1", 6.3, 18.55, -69.95, 4000)}}
	out, _, _, cancel := start(t, u, e)
	defer cancel()
	first := recv(t, out)
	if first.Kind != pipeline.KindNew {
		t.Fatalf("first must be new: %+v", first)
	}
	select {
	case extra := <-out:
		t.Fatalf("duplicate across sources must not emit twice: %+v", extra)
	case <-time.After(150 * time.Millisecond):
	}
}

func TestEMSCDownUSGSStillDelivers(t *testing.T) {
	u := &fake{name: "usgs", items: []sources.Observation{obs("usgs", "us2", 5.6, 19.0, -70.5, 0)}}
	e := &fake{name: "emsc", failErr: errors.New("ws refused")}
	out, h, logs, cancel := start(t, u, e)
	defer cancel()
	if got := recv(t, out); got.Source != "usgs" || got.Kind != pipeline.KindNew {
		t.Fatalf("USGS must deliver when EMSC is down: %+v", got)
	}
	time.Sleep(120 * time.Millisecond)
	var emscUp bool
	for _, s := range h.Snapshot() {
		if s.Source == "emsc" {
			emscUp = s.Up
		}
	}
	if emscUp || !strings.Contains(logs.String(), `"source":"emsc"`) {
		t.Fatalf("EMSC outage must be visible in health/logs:\n%s", logs)
	}
}

func TestUSGSDownEMSCFallbackAndPrimaryAlarm(t *testing.T) {
	u := &fake{name: "usgs", failErr: errors.New("503 Service Unavailable")}
	e := &fake{name: "emsc", items: []sources.Observation{obs("emsc", "e9", 6.1, 18.2, -68.9, 0)}}
	out, _, logs, cancel := start(t, u, e)
	defer cancel()
	if got := recv(t, out); got.Source != "emsc" || got.Kind != pipeline.KindNew {
		t.Fatalf("EMSC must deliver as fallback: %+v", got)
	}
	deadline := time.Now().Add(2 * time.Second)
	for !strings.Contains(logs.String(), `"event":"source_down_alarm","source":"usgs","primary":true`) {
		if time.Now().After(deadline) {
			t.Fatalf("primary outage must raise ops alarm:\n%s", logs)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestPanickingConnectorIsRestartedWithoutStoppingOthers(t *testing.T) {
	bad := &fake{name: "emsc", doPanic: true, items: []sources.Observation{obs("emsc", "e5", 4.8, 17.9, -71.0, 0)}}
	good := &fake{name: "usgs", items: []sources.Observation{obs("usgs", "us5", 5.0, 19.5, -70.0, 0)}}
	out, _, _, cancel := start(t, bad, good)
	defer cancel()
	got := map[string]bool{}
	for len(got) < 2 {
		got[recv(t, out).Source] = true
	}
	if bad.panics.Load() != 1 || bad.runs.Load() < 2 {
		t.Fatalf("connector must be restarted after panic: panics=%d runs=%d", bad.panics.Load(), bad.runs.Load())
	}
}

func TestRevisionFromPrimaryIsEmitted(t *testing.T) {
	a := obs("usgs", "us7", 6.4, 18.5, -69.9, 0)
	b := obs("usgs", "us7", 6.2, 18.5, -69.9, 60_000)
	out, _, _, cancel := start(t, &fake{name: "usgs", items: []sources.Observation{a, b}})
	defer cancel()
	if k := recv(t, out).Kind; k != pipeline.KindNew {
		t.Fatalf("got %v", k)
	}
	rev := recv(t, out)
	if rev.Kind != pipeline.KindRevision || rev.Event.Magnitude != 6.2 || rev.Event.RevisionSeq != 1 {
		t.Fatalf("revision 6.4 → 6.2 expected: %+v", rev)
	}
}

func TestBuildProvidersFromRegionConfig(t *testing.T) {
	r, err := regioncfg.Load("../../../packages/config/regions", "DO")
	if err != nil {
		t.Fatal(err)
	}
	h := health.NewRegistry(time.Minute, nil, nil)
	ps := BuildProviders(r, h)
	var nUSGS, nEMSC, nDisabled int
	for _, p := range ps {
		switch v := p.(type) {
		case *usgs.Poller:
			nUSGS++
			if !strings.HasPrefix(v.URL, "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/") || v.Interval != 30*time.Second {
				t.Fatalf("poller: %s %v", v.URL, v.Interval)
			}
			v.OnResult(10*time.Millisecond, nil)
			v.OnResult(0, errors.New("x"))
		case *emsc.Client:
			nEMSC++
			if v.URL != "wss://www.seismicportal.eu/standing_order/websocket" {
				t.Fatalf("emsc url %s", v.URL)
			}
			v.OnStatus(nil)
			v.OnStatus(errors.New("drop"))
		case sources.Disabled:
			nDisabled++
			if v.Enabled() {
				t.Fatal("disabled connector enabled")
			}
		}
	}
	if nUSGS != 2 || nEMSC != 1 || nDisabled != 3 {
		t.Fatalf("providers: usgs=%d emsc=%d disabled=%d", nUSGS, nEMSC, nDisabled)
	}
	snap := h.Snapshot()
	if len(snap) != 2 || snap[1].Source != "usgs" || !snap[1].Primary || snap[0].Primary {
		t.Fatalf("health registration: %+v", snap)
	}
}
