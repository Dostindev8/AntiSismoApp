package main

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"antisismo.app/delivery/metrics"
	"antisismo.app/delivery/worker"
	"antisismo.app/ingestion/health"
)

var quiet = slog.New(slog.NewTextHandler(io.Discard, nil))

func seed(t *testing.T) string {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return base64.RawURLEncoding.EncodeToString(priv.Seed())
}

func TestSignersRefuseToStartWithoutKeyOutsideDev(t *testing.T) {
	t.Setenv("SIGNING_SEED_B64", "")
	t.Setenv("ANTISISMO_ENV", "production")
	if _, _, err := signers(quiet); err == nil || !strings.Contains(err.Error(), "BLK-03") {
		t.Fatalf("want refusal, got %v", err)
	}
	t.Setenv("ANTISISMO_ENV", "dev")
	p, b, err := signers(quiet)
	if err != nil || p.Kid() != "k-dev-ephemeral" || b != nil {
		t.Fatalf("dev ephemeral key: %v", err)
	}
}

func TestSignersFromSecretEnv(t *testing.T) {
	t.Setenv("SIGNING_KID", "k-2026-09")
	t.Setenv("SIGNING_SEED_B64", seed(t))
	t.Setenv("SIGNING_BACKUP_KID", "k-2026-12")
	t.Setenv("SIGNING_BACKUP_SEED_B64", seed(t))
	p, b, err := signers(quiet)
	if err != nil || p.Kid() != "k-2026-09" || b == nil || b.Kid() != "k-2026-12" {
		t.Fatalf("signers: %v", err)
	}
	t.Setenv("SIGNING_BACKUP_SEED_B64", "not-base64!")
	if _, _, err := signers(quiet); err == nil {
		t.Fatal("malformed backup seed accepted")
	}
	t.Setenv("SIGNING_SEED_B64", "short")
	if _, _, err := signers(quiet); err == nil {
		t.Fatal("malformed seed accepted")
	}
}

func TestPushTransportUnconfiguredIsVisible(t *testing.T) {
	t.Setenv("FCM_PROJECT_ID", "")
	if tr := pushTransport(context.Background(), quiet); tr.Name() != "unconfigured" {
		t.Fatalf("transport %s", tr.Name())
	}
	t.Setenv("FCM_PROJECT_ID", "antisismo-test")
	t.Setenv("GOOGLE_APPLICATION_CREDENTIALS", t.TempDir()+"/missing.json")
	if tr := pushTransport(context.Background(), quiet); tr.Name() != "unconfigured" {
		t.Fatalf("missing credentials must degrade, got %s", tr.Name())
	}
}

func TestHealthAndMetricsEndpoints(t *testing.T) {
	h := health.NewRegistry(time.Minute, quiet, nil)
	h.Register("usgs", true)
	m := metrics.NewDelivery()
	m.TransportReady.Store(false)
	srv := httptest.NewServer(mux(h, m, worker.NewDeadLetter(4)))
	defer srv.Close()

	resp, err := srv.Client().Get(srv.URL + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&body)
	resp.Body.Close()
	if resp.StatusCode != 200 || body["degraded"] != true || body["push_transport_ready"] != false {
		t.Fatalf("healthz: %d %+v", resp.StatusCode, body)
	}

	resp, err = srv.Client().Get(srv.URL + "/metrics")
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	for _, want := range []string{"antisismo_source_up", "antisismo_push_transport_ready 0", "antisismo_latency_e2e_ms_count"} {
		if !strings.Contains(string(b), want) {
			t.Errorf("metrics missing %q", want)
		}
	}
	if r, _ := srv.Client().Post(srv.URL+"/metrics", "text/plain", nil); r == nil || r.StatusCode != 405 {
		t.Fatal("metrics must be GET-only")
	}
}

func TestEnvDefault(t *testing.T) {
	t.Setenv("ANTISISMO_X", "")
	if env("ANTISISMO_X", "d") != "d" {
		t.Fatal("default")
	}
	t.Setenv("ANTISISMO_X", "v")
	if env("ANTISISMO_X", "d") != "v" {
		t.Fatal("override")
	}
}
