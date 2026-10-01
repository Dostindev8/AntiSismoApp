// alertd: binario del camino crítico (ingesta → decisión → firma → cola → FCM/APNs).
// Depende solo de Redis (opcional, con respaldo en memoria). Configuración: variables de entorno
// documentadas en .env.example; umbrales/hosts en packages/config/regions; textos en packages/config/i18n.
package main

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	"github.com/redis/go-redis/v9"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"

	"antisismo.app/decision/engine"
	"antisismo.app/delivery/dispatch"
	"antisismo.app/delivery/metrics"
	"antisismo.app/delivery/queue"
	"antisismo.app/delivery/transport"
	"antisismo.app/delivery/worker"
	"antisismo.app/ingestion/health"
	"antisismo.app/ingestion/pipeline"
	"antisismo.app/ingestion/regioncfg"
	"antisismo.app/ingestion/resilience"
	"antisismo.app/ingestion/runner"
)

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	if err := run(log); err != nil {
		log.Error("alertd stopped", "error", err.Error())
		os.Exit(1)
	}
}

func run(log *slog.Logger) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cfgDir := env("ANTISISMO_CONFIG_DIR", "packages/config")
	region, err := regioncfg.Load(filepath.Join(cfgDir, "regions"), env("ANTISISMO_REGION", "DO"))
	if err != nil {
		return err
	}
	texts, err := dispatch.LoadTexts(filepath.Join(cfgDir, "i18n"), region.Locale)
	if err != nil {
		return err
	}
	ecfg, err := dispatch.EngineConfig(region)
	if err != nil {
		return err
	}
	primary, backup, err := signers(log)
	if err != nil {
		return err
	}

	m := metrics.NewDelivery()
	mem := queue.NewMemory(50_000)
	var q *queue.Fallback
	if url := os.Getenv("REDIS_URL"); url != "" {
		opt, err := redis.ParseURL(url)
		if err != nil {
			return fmt.Errorf("REDIS_URL: %w", err)
		}
		opt.DialTimeout, opt.ReadTimeout, opt.WriteTimeout = time.Second, time.Second, time.Second
		rq, err := queue.NewRedis(ctx, redis.NewClient(opt), "alertd-"+strconv.Itoa(os.Getpid()))
		if err != nil {
			log.Error("redis unavailable at start; using in-memory queue", "event", "queue_degraded", "error", err.Error())
			q = queue.NewFallback(nil, mem)
			m.QueueDegraded.Store(true)
		} else {
			q = queue.NewFallback(rq, mem)
		}
	} else {
		log.Warn("REDIS_URL not set; in-memory queue only", "event", "queue_degraded")
		q = queue.NewFallback(nil, mem)
		m.QueueDegraded.Store(true)
	}

	tr := pushTransport(ctx, log)
	m.TransportReady.Store(tr.Name() != "unconfigured")

	h := health.NewRegistry(time.Duration(region.Ops.SourceDownAlarmSeconds)*time.Second, log, nil)
	emitted := make(chan runner.Emitted, 256)
	rn := &runner.Runner{
		Pipeline: pipeline.New(region.DedupConfig(), 7*24*time.Hour), Health: h,
		Providers: runner.BuildProviders(region, h), Out: emitted, Log: log,
	}
	d := &dispatch.Dispatcher{Cfg: ecfg, Primary: primary, Backup: backup, Queue: q, Texts: texts, Metrics: m, Log: log}
	dlq := worker.NewDeadLetter(10_000)

	workers, _ := strconv.Atoi(env("DELIVERY_WORKERS", "32"))
	for i := 0; i < max(1, min(workers, 256)); i++ {
		w := &worker.Worker{Queue: q, Transport: tr, DLQ: dlq, Metrics: m, Log: log}
		go func() { _ = w.Run(ctx) }()
	}
	go func() {
		prune := time.NewTicker(time.Hour)
		defer prune.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case e := <-emitted:
				if _, err := d.Handle(ctx, e.Event); err != nil {
					log.Error("dispatch error", "event", "dispatch_error", "event_id", e.Event.ID, "error", err.Error())
				}
			case <-prune.C:
				d.Prune(time.Now().UnixMilli(), 24*time.Hour)
			}
		}
	}()
	go func() {
		t := time.NewTicker(5 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				m.QueueDegraded.Store(q.Degraded() || os.Getenv("REDIS_URL") == "")
			}
		}
	}()

	srv := &http.Server{Addr: env("METRICS_ADDR", "127.0.0.1:9101"), Handler: mux(h, m, dlq), ReadHeaderTimeout: 2 * time.Second}
	go func() {
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("metrics server", "error", err.Error())
		}
	}()
	log.Info("alertd started", "region", region.Region, "transport", tr.Name(), "signing_kid", primary.Kid())
	err = rn.Run(ctx)
	sctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_ = srv.Shutdown(sctx)
	if errors.Is(err, context.Canceled) {
		return nil
	}
	return err
}

func mux(h *health.Registry, m *metrics.Delivery, dlq *worker.DeadLetter) http.Handler {
	mx := http.NewServeMux()
	mx.HandleFunc("GET /metrics", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4")
		_ = h.WritePrometheus(w)
		_ = m.WritePrometheus(w)
	})
	mx.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		alarms := h.Check()
		degraded := len(alarms) > 0 || m.QueueDegraded.Load() || !m.TransportReady.Load() || dlq.Len() > 0
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status": "ok", "degraded": degraded, "sources": h.Snapshot(), "source_alarms": alarms,
			"queue_degraded": m.QueueDegraded.Load(), "push_transport_ready": m.TransportReady.Load(), "dlq": dlq.Len(),
		})
	})
	return mx
}

// signers: clave primaria y de respaldo desde el secret manager (variables inyectadas en runtime).
// En ANTISISMO_ENV=dev se genera una clave efímera (nunca se registra ni se persiste).
func signers(log *slog.Logger) (engine.Signer, engine.Signer, error) {
	if seed := os.Getenv("SIGNING_SEED_B64"); seed != "" {
		p, err := engine.NewLocalSignerFromSeed(env("SIGNING_KID", ""), seed)
		if err != nil {
			return nil, nil, err
		}
		var b engine.Signer
		if bs := os.Getenv("SIGNING_BACKUP_SEED_B64"); bs != "" {
			bb, err := engine.NewLocalSignerFromSeed(env("SIGNING_BACKUP_KID", ""), bs)
			if err != nil {
				return nil, nil, err
			}
			b = bb
		}
		return p, b, nil
	}
	if os.Getenv("ANTISISMO_ENV") != "dev" {
		return nil, nil, errors.New("SIGNING_SEED_B64 missing: refusing to start without signing key outside dev (BLK-03)")
	}
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, nil, err
	}
	s, err := engine.NewLocalSigner("k-dev-ephemeral", priv)
	if err != nil {
		return nil, nil, err
	}
	log.Warn("using ephemeral dev signing key; devices will not verify these alerts", "event", "dev_signing_key", "public_key", s.PublicKeyB64())
	return s, nil, nil
}

type oauthTokens struct{ ts oauth2.TokenSource }

func (o oauthTokens) Token(context.Context) (string, error) {
	t, err := o.ts.Token()
	if err != nil {
		return "", err
	}
	return t.AccessToken, nil
}

// pushTransport: FCM HTTP v1 si hay proyecto y credenciales (GOOGLE_APPLICATION_CREDENTIALS fuera del
// repo o identidad de carga de trabajo). Si no, Unconfigured: cada alerta va a DLQ con alarma visible.
func pushTransport(ctx context.Context, log *slog.Logger) transport.Transport {
	project := os.Getenv("FCM_PROJECT_ID")
	if project == "" {
		log.Error("FCM_PROJECT_ID not set: push delivery disabled (BLK-01)", "event", "push_unconfigured")
		return transport.Unconfigured{}
	}
	hc := resilience.NewHTTPClient([]string{"fcm.googleapis.com", "oauth2.googleapis.com"}, 3*time.Second)
	octx := context.WithValue(ctx, oauth2.HTTPClient, hc)
	ts, err := google.DefaultTokenSource(octx, "https://www.googleapis.com/auth/firebase.messaging")
	if err != nil {
		log.Error("FCM credentials unavailable: push delivery disabled (BLK-01)", "event", "push_unconfigured", "error", err.Error())
		return transport.Unconfigured{}
	}
	return &transport.FCM{ProjectID: project, Client: hc, Tokens: oauthTokens{oauth2.ReuseTokenSource(nil, ts)}}
}
