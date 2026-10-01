package e2e

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"math"
	randv2 "math/rand/v2"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"slices"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"

	"antisismo.app/decision/engine"
	"antisismo.app/delivery/dispatch"
	"antisismo.app/delivery/metrics"
	"antisismo.app/delivery/queue"
	"antisismo.app/delivery/transport"
	"antisismo.app/delivery/worker"
	"antisismo.app/ingestion/pipeline"
	"antisismo.app/ingestion/regioncfg"
	"antisismo.app/ingestion/sources/usgs"
	"antisismo.app/proto/contract"
)

// Presupuestos del Blueprint (§17): p50 < 2 s, p99 < 4 s evento recibido → aceptado por el proveedor;
// normalizador < 200 ms; decisión < 100 ms.
const (
	budgetP50       = 2000
	budgetP99       = 4000
	budgetNormalize = 200 * time.Millisecond
	budgetDecision  = 100 * time.Millisecond
	events          = 30
	eventSpacing    = 250 * time.Millisecond
	workers         = 64
)

type staticToken struct{}

func (staticToken) Token(context.Context) (string, error) { return "e2e", nil }

// fakeFCM: latencia log-normal (mediana 120 ms, σ 0.6 ⇒ p99 ≈ 490 ms) y 2 % de 503 transitorios.
// SIMULADO: no representa una medición del proveedor real.
type fakeFCM struct {
	mu       sync.Mutex
	rng      *randv2.Rand
	recvAt   *sync.Map // alert_id → ms de recepción en ingesta
	critical []int64   // latencias e2e (ms) de push CRITICAL aceptados
	keys     map[string]string
	bad      atomic.Int64
	total    atomic.Int64
	err503   atomic.Int64
}

func (f *fakeFCM) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Message struct {
			Data map[string]string `json:"data"`
		} `json:"message"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&body); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	f.mu.Lock()
	lat := time.Duration(120*math.Exp(0.6*f.rng.NormFloat64())) * time.Millisecond
	fail := f.rng.Float64() < 0.02
	f.mu.Unlock()
	time.Sleep(lat)
	if fail {
		f.err503.Add(1)
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	f.total.Add(1)
	d := body.Message.Data
	if d["level"] == "CRITICAL" {
		now := time.Now().UnixMilli()
		if action, _ := contract.Classify([]byte(d["alert"]), now, f.keys); action != contract.ActionAlarm {
			f.bad.Add(1)
		}
		if v, ok := f.recvAt.Load(d["alert_id"]); ok {
			f.mu.Lock()
			f.critical = append(f.critical, now-v.(int64))
			f.mu.Unlock()
		}
	}
	w.WriteHeader(http.StatusOK)
}

func feed(i int, originMs int64) []byte {
	lat := 18.40 + float64(i%6)*0.05
	lon := -70.10 + float64(i%5)*0.08
	mag := 6.0 + float64(i%9)*0.1
	return fmt.Appendf(nil, `{"type":"FeatureCollection","features":[{"type":"Feature","id":"us7e2e%03d",`+
		`"properties":{"mag":%.1f,"place":"Prueba e2e %d","time":%d,"updated":%d,"status":"automatic","tsunami":0,"magType":"mww","type":"earthquake"},`+
		`"geometry":{"type":"Point","coordinates":[%.4f,%.4f,12]}}]}`, i, mag, i, originMs, originMs, lon, lat)
}

func quantile(s []int64, q float64) int64 {
	s = slices.Clone(s)
	slices.Sort(s)
	idx := int(math.Ceil(q*float64(len(s)))) - 1
	return s[max(0, min(idx, len(s)-1))]
}

func dquantile(s []time.Duration, q float64) time.Duration {
	slices.Sort(s)
	idx := int(math.Ceil(q*float64(len(s)))) - 1
	return s[max(0, min(idx, len(s)-1))]
}

func TestCriticalPathLatencyBudget(t *testing.T) {
	if testing.Short() {
		t.Skip("e2e latency harness")
	}
	cfgDir := filepath.Join("..", "..", "..", "packages", "config")
	region, err := regioncfg.Load(filepath.Join(cfgDir, "regions"), "DO")
	if err != nil {
		t.Fatal(err)
	}
	ecfg, err := dispatch.EngineConfig(region)
	if err != nil {
		t.Fatal(err)
	}
	texts, err := dispatch.LoadTexts(filepath.Join(cfgDir, "i18n"), region.Locale)
	if err != nil {
		t.Fatal(err)
	}
	_, priv, _ := ed25519.GenerateKey(rand.Reader)
	signer, _ := engine.NewLocalSigner("k-e2e", priv)

	recvAt := &sync.Map{}
	fcm := &fakeFCM{rng: randv2.New(randv2.NewPCG(2026, 9)), recvAt: recvAt, keys: map[string]string{"k-e2e": signer.PublicKeyB64()}}
	srv := httptest.NewTLSServer(fcm)
	defer srv.Close()
	srv.Client().Transport.(*http.Transport).MaxIdleConnsPerHost = workers

	mr := miniredis.RunT(t)
	rc := redis.NewClient(&redis.Options{Addr: mr.Addr(), PoolSize: workers + 8})
	defer rc.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	rq, err := queue.NewRedis(ctx, rc, "e2e")
	if err != nil {
		t.Fatal(err)
	}
	q := queue.NewFallback(rq, queue.NewMemory(100_000))
	m := metrics.NewDelivery()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	tr := &transport.FCM{ProjectID: "antisismo-e2e", Endpoint: srv.URL, Client: srv.Client(), Tokens: staticToken{}}
	dlq := worker.NewDeadLetter(10_000)
	for range workers {
		w := &worker.Worker{Queue: q, Transport: tr, DLQ: dlq, Metrics: m, Log: log}
		go func() { _ = w.Run(ctx) }()
	}

	pipe := pipeline.New(region.DedupConfig(), time.Hour)
	d := &dispatch.Dispatcher{Cfg: ecfg, Primary: signer, Queue: q, Texts: texts, Metrics: m, Log: log}
	var st usgs.Stats
	var normDur, decideDur, handleDur []time.Duration
	expectedCritical := 0
	start := time.Now()
	for i := range events {
		origin := start.UnixMilli() - int64(events-i)*20_000 - 4_000 // eventos distintos (fuera de la ventana de dedup)
		body := feed(i, origin)
		received := time.Now()

		t0 := time.Now()
		obs, err := usgs.Parse(body, received.UnixMilli(), &st)
		if err != nil || len(obs) != 1 {
			t.Fatalf("parse %d: %v", i, err)
		}
		ev, kind := pipe.Ingest(obs[0])
		normDur = append(normDur, time.Since(t0))
		if kind != pipeline.KindNew {
			t.Fatalf("event %d not new (kind=%d)", i, kind)
		}

		t1 := time.Now()
		decisions := engine.Decide(ev, ecfg, time.Now().UnixMilli())
		decideDur = append(decideDur, time.Since(t1))
		for _, dec := range decisions {
			if dec.Level == engine.LevelCritical {
				expectedCritical++
			}
		}
		recvAt.Store(contract.ComputeAlertID(ev.ID, ev.RevisionSeq), received.UnixMilli())

		t2 := time.Now()
		if _, err := d.Handle(ctx, ev); err != nil {
			t.Fatalf("handle %d: %v", i, err)
		}
		handleDur = append(handleDur, time.Since(t2))
		time.Sleep(eventSpacing)
	}

	deadline := time.After(60 * time.Second)
	for {
		fcm.mu.Lock()
		n := len(fcm.critical)
		fcm.mu.Unlock()
		if n >= expectedCritical {
			break
		}
		select {
		case <-deadline:
			t.Fatalf("only %d/%d critical pushes delivered (dlq=%d)", n, expectedCritical, dlq.Len())
		case <-time.After(10 * time.Millisecond):
		}
	}
	cancel()

	fcm.mu.Lock()
	lat := slices.Clone(fcm.critical)
	fcm.mu.Unlock()
	p50, p90, p99, pmax := quantile(lat, 0.5), quantile(lat, 0.9), quantile(lat, 0.99), quantile(lat, 1)
	nP99, dP99, hP99 := dquantile(normDur, 0.99), dquantile(decideDur, 0.99), dquantile(handleDur, 0.99)
	t.Logf("E2E (proveedor push SIMULADO: log-normal mediana 120 ms, 2%% 503) — %d eventos, %d push CRITICAL, %d workers, Redis Streams (miniredis)", events, len(lat), workers)
	t.Logf("latencia CRITICAL recibido→aceptado: p50=%d ms p90=%d ms p99=%d ms max=%d ms (presupuesto p50<%d p99<%d)", p50, p90, p99, pmax, budgetP50, budgetP99)
	t.Logf("etapas p99: normalización=%v (<%v) decisión=%v (<%v) firma+encolado de todas las celdas=%v", nP99, budgetNormalize, dP99, budgetDecision, hP99)
	t.Logf("proveedor: %d aceptados, %d 503 reintentados, DLQ=%d, reintentos=%d", fcm.total.Load(), fcm.err503.Load(), dlq.Len(), m.Retries.Load())

	for _, dj := range dlq.Drain() {
		if dj.Level == "CRITICAL" {
			t.Fatalf("critical push dead-lettered: %+v", dj.Topic)
		}
	}
	if fcm.bad.Load() != 0 {
		t.Fatalf("%d critical pushes would not alarm on device", fcm.bad.Load())
	}
	if p50 >= budgetP50 || p99 >= budgetP99 {
		t.Fatalf("latency budget exceeded: p50=%d p99=%d", p50, p99)
	}
	if nP99 >= budgetNormalize || dP99 >= budgetDecision {
		t.Fatalf("stage budget exceeded: normalize=%v decision=%v", nP99, dP99)
	}
	if expectedCritical == 0 {
		t.Fatal("harness produced no critical alerts")
	}
}
