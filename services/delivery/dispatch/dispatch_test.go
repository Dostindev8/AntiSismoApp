package dispatch

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"antisismo.app/decision/engine"
	"antisismo.app/delivery/metrics"
	"antisismo.app/delivery/queue"
	"antisismo.app/geo/geo"
	"antisismo.app/ingestion/regioncfg"
	"antisismo.app/proto/contract"
)

const t0 = int64(1790627527000)

var i18nDir = filepath.Join("..", "..", "..", "packages", "config", "i18n")

// Umbrales iguales a packages/config/regions/DO.yaml.
func cfgDO() engine.Config {
	return engine.Config{
		Region:                 "DO",
		Critical:               engine.Threshold{MinMagnitude: 5.0, MaxDistanceKm: 250, MinExpectedMMI: 5.0},
		Informative:            engine.Threshold{MinMagnitude: 4.0, MaxDistanceKm: 400, MinExpectedMMI: 3.0},
		ForceCriticalOnTsunami: true,
		BBox:                   geo.Box{MinLat: 16, MaxLat: 22, MinLon: -76, MaxLon: -65},
		TopicPrecision:         4,
		Validity:               5 * time.Minute,
		SWaveKmPerS:            3.5,
	}
}

func event(mag float64, rev int) contract.Event {
	return contract.Event{
		ID: "6f1c2a3b-4d5e-5f60-8a7b-9c0d1e2f3a4b", SourceIDs: map[string]string{"usgs": "us7000test"},
		Type: "EARTHQUAKE", Magnitude: mag, MagType: "mww", TimeUTCms: t0, ReceivedAtMs: t0 + 3000,
		Lon: -69.9312, Lat: 18.4861, DepthKm: 10, Place: "10 km S de Santo Domingo",
		SolutionStatus: "automatic", RevisionSeq: rev,
	}
}

func key(t *testing.T, kid string) (*engine.LocalSigner, string) {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	s, err := engine.NewLocalSigner(kid, priv)
	if err != nil {
		t.Fatal(err)
	}
	return s, s.PublicKeyB64()
}

type brokenSigner struct{ kid string }

func (b brokenSigner) Kid() string                 { return b.kid }
func (b brokenSigner) Sign([]byte) ([]byte, error) { return nil, errors.New("kms unavailable") }

type failingQueue struct{ queue.Queue }

func (failingQueue) Push(context.Context, queue.Job) error { return errors.New("queue down") }

type fixture struct {
	d    *Dispatcher
	q    *queue.Memory
	keys map[string]string
	logs *bytes.Buffer
}

func newFixture(t *testing.T, primary, backup engine.Signer, keys map[string]string) fixture {
	t.Helper()
	texts, err := LoadTexts(i18nDir, "es-DO")
	if err != nil {
		t.Fatal(err)
	}
	q := queue.NewMemory(10_000)
	logs := &bytes.Buffer{}
	d := &Dispatcher{
		Cfg: cfgDO(), Primary: primary, Backup: backup, Queue: q, Texts: texts, Metrics: metrics.NewDelivery(),
		Log: slog.New(slog.NewJSONHandler(logs, nil)), Now: func() time.Time { return time.UnixMilli(t0 + 4000) },
	}
	return fixture{d: d, q: q, keys: keys, logs: logs}
}

func (f fixture) drain() map[string]queue.Job {
	out := map[string]queue.Job{}
	for {
		j, ok := f.q.TryPop()
		if !ok {
			return out
		}
		out[j.Topic] = j
	}
}

func (f fixture) classify(t *testing.T, j queue.Job) contract.Action {
	t.Helper()
	a, _ := contract.Classify(j.Payload, t0+5000, f.keys)
	return a
}

func TestCriticalQuakeEnqueuesSignedAlarms(t *testing.T) {
	s, pub := key(t, "k-active")
	f := newFixture(t, s, nil, map[string]string{"k-active": pub})
	n, err := f.d.Handle(context.Background(), event(6.4, 0))
	if err != nil || n == 0 {
		t.Fatalf("n=%d err=%v", n, err)
	}
	jobs := f.drain()
	if len(jobs) != n {
		t.Fatalf("jobs=%d n=%d", len(jobs), n)
	}
	epi, ok := jobs["alerts_DO_d7q3"]
	if !ok || epi.Priority != queue.Critical || epi.Level != "CRITICAL" {
		t.Fatalf("epicentral job: %+v", epi)
	}
	if got := f.classify(t, epi); got != contract.ActionAlarm {
		t.Fatalf("device classification %s", got)
	}
	texts, _ := LoadTexts(i18nDir, "es-DO")
	if epi.Title != texts["alert.title.earthquake"] || epi.Body != texts["instruction.DROP_COVER_HOLD_ON"] || epi.ReceivedAtMs != t0+3000 {
		t.Fatalf("texts/timing: %+v", epi)
	}
	if epi.ID != contract.ComputeAlertID(event(6.4, 0).ID, 0)+":alerts_DO_d7q3" {
		t.Fatalf("job id not idempotent: %s", epi.ID)
	}
	for _, j := range jobs {
		if j.Level == "INFORMATIVE" && (j.Priority != queue.Informative || !strings.Contains(j.Body, "6.4")) {
			t.Fatalf("informative job: %+v", j)
		}
	}
}

func TestRevisionNeverReAlarmsAndNeverCancels(t *testing.T) {
	s, pub := key(t, "k-active")
	f := newFixture(t, s, nil, map[string]string{"k-active": pub})
	ctx := context.Background()
	if _, err := f.d.Handle(ctx, event(6.4, 0)); err != nil {
		t.Fatal(err)
	}
	first := f.drain()

	// Revisión al alza: las celdas que ya sonaron reciben INFORMATIVE; las nuevas celdas críticas sí alarman.
	if _, err := f.d.Handle(ctx, event(6.9, 1)); err != nil {
		t.Fatal(err)
	}
	second := f.drain()
	newCritical := 0
	for topic, j := range second {
		if prev, ok := first[topic]; ok && prev.Level == "CRITICAL" {
			if j.Level != "INFORMATIVE" || f.classify(t, j) != contract.ActionInformative {
				t.Fatalf("%s re-alarmed: %+v", topic, j)
			}
		}
		if j.Level == "CRITICAL" {
			newCritical++
			if f.classify(t, j) != contract.ActionAlarm {
				t.Fatalf("new critical cell %s does not alarm", topic)
			}
		}
	}
	if newCritical == 0 {
		t.Fatal("upward revision must alarm newly reached cells")
	}

	// Revisión a la baja: nunca una "cancelación"; solo actualizaciones informativas.
	if _, err := f.d.Handle(ctx, event(5.6, 2)); err != nil {
		t.Fatal(err)
	}
	for topic, j := range f.drain() {
		if strings.Contains(string(j.Payload), "cancel") {
			t.Fatalf("%s: cancellation sent", topic)
		}
		if _, sounded := first[topic]; sounded && first[topic].Level == "CRITICAL" && j.Level != "INFORMATIVE" {
			t.Fatalf("%s re-alarmed on downgrade", topic)
		}
	}
}

func TestUpgradeFromInformativeToCriticalAlarms(t *testing.T) {
	s, pub := key(t, "k-active")
	f := newFixture(t, s, nil, map[string]string{"k-active": pub})
	ctx := context.Background()
	_, _ = f.d.Handle(ctx, event(4.5, 0))
	if j := f.drain()["alerts_DO_d7q3"]; j.Level != "INFORMATIVE" {
		t.Fatalf("M4.5 must be informative: %+v", j)
	}
	_, _ = f.d.Handle(ctx, event(6.4, 1))
	j := f.drain()["alerts_DO_d7q3"]
	if j.Level != "CRITICAL" || f.classify(t, j) != contract.ActionAlarm {
		t.Fatalf("upgrade must alarm: %+v", j)
	}
}

func TestPrimaryKMSDownUsesBackupKey(t *testing.T) {
	backup, pub := key(t, "k-next")
	f := newFixture(t, brokenSigner{"k-active"}, backup, map[string]string{"k-next": pub})
	if _, err := f.d.Handle(context.Background(), event(6.4, 0)); err != nil {
		t.Fatal(err)
	}
	j := f.drain()["alerts_DO_d7q3"]
	var a contract.SignedAlert
	if err := json.Unmarshal(j.Payload, &a); err != nil {
		t.Fatal(err)
	}
	if a.Kid != "k-next" || f.classify(t, j) != contract.ActionAlarm || f.d.Metrics.SignFailures.Load() != 0 {
		t.Fatalf("kid=%s action=%s", a.Kid, f.classify(t, j))
	}
}

func TestAllSignersDownSendsReconcileNeverSilenceNeverFalseAlarm(t *testing.T) {
	f := newFixture(t, brokenSigner{"k-active"}, brokenSigner{"k-next"}, map[string]string{})
	n, err := f.d.Handle(context.Background(), event(6.4, 0))
	if err != nil || n == 0 {
		t.Fatalf("n=%d err=%v", n, err)
	}
	j := f.drain()["alerts_DO_d7q3"]
	if j.Priority != queue.Critical {
		t.Fatal("reconcile push must keep critical priority (wake the device)")
	}
	if got := f.classify(t, j); got != contract.ActionReconcile {
		t.Fatalf("unsigned payload must reconcile, got %s", got)
	}
	if f.d.Metrics.SignFailures.Load() == 0 || !strings.Contains(f.logs.String(), `"event":"sign_failed"`) {
		t.Fatal("sign failure must be visible in metrics and logs")
	}
}

func TestEnqueueFailureIsReportedAndRetryStillAlarms(t *testing.T) {
	s, pub := key(t, "k-active")
	f := newFixture(t, s, nil, map[string]string{"k-active": pub})
	mem := f.d.Queue
	f.d.Queue = failingQueue{mem}
	if n, err := f.d.Handle(context.Background(), event(6.4, 0)); err == nil || n != 0 {
		t.Fatalf("n=%d err=%v", n, err)
	}
	if !strings.Contains(f.logs.String(), `"event":"enqueue_failed"`) {
		t.Fatal("enqueue failure not logged")
	}
	// Un fallo de encolado no marca la celda como "ya sonó": el reintento debe alarmar.
	f.d.Queue = mem
	_, _ = f.d.Handle(context.Background(), event(6.4, 0))
	if j := f.drain()["alerts_DO_d7q3"]; j.Level != "CRITICAL" {
		t.Fatalf("retry after enqueue failure must alarm: %+v", j)
	}
}

func TestOutOfScopeEventsEnqueueNothingAndPrune(t *testing.T) {
	s, _ := key(t, "k-active")
	f := newFixture(t, s, nil, nil)
	far := event(6.4, 0)
	far.Lat, far.Lon = 35.68, 139.69 // Tokio
	if n, _ := f.d.Handle(context.Background(), far); n != 0 {
		t.Fatalf("far event enqueued %d", n)
	}
	_, _ = f.d.Handle(context.Background(), event(6.4, 0))
	if got := f.d.Prune(t0+time.Hour.Milliseconds(), 24*time.Hour); got != 0 {
		t.Fatalf("pruned too early: %d", got)
	}
	if got := f.d.Prune(t0+25*time.Hour.Milliseconds(), 24*time.Hour); got != 1 {
		t.Fatalf("prune: %d", got)
	}
}

func TestEngineConfigFromRegionYAML(t *testing.T) {
	r, err := regioncfg.Load(filepath.Join("..", "..", "..", "packages", "config", "regions"), "DO")
	if err != nil {
		t.Fatal(err)
	}
	got, err := EngineConfig(r)
	if err != nil {
		t.Fatal(err)
	}
	if got != cfgDO() {
		t.Fatalf("DO.yaml drifted from test thresholds:\n got %+v\nwant %+v", got, cfgDO())
	}
	r.Thresholds.Critical.MinExpectedMMI = 3
	if _, err := EngineConfig(r); err == nil {
		t.Fatal("invalid thresholds accepted")
	}
}

func TestLoadTextsValidation(t *testing.T) {
	if _, err := LoadTexts(i18nDir, "xx-XX"); err != nil {
		t.Fatalf("missing locale file must fall back to es-DO: %v", err)
	}
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "es-DO.json"), []byte(`{"alert.title.earthquake":"x"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadTexts(dir, "es-DO"); err == nil || !strings.Contains(err.Error(), "missing i18n key") {
		t.Fatalf("want missing key error, got %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "es-DO.json"), []byte(`{`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadTexts(dir, "es-DO"); err == nil {
		t.Fatal("malformed json accepted")
	}
	if _, err := LoadTexts(t.TempDir(), "es-DO"); err == nil {
		t.Fatal("missing base locale accepted")
	}
}
