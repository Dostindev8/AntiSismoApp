package engine

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"antisismo.app/geo/geo"
	"antisismo.app/proto/contract"
)

const t0 = int64(1790627527000)

// Umbrales iguales a packages/config/regions/DO.yaml (el binario los carga de ahí).
func cfgDO() Config {
	return Config{
		Region:                 "DO",
		Critical:               Threshold{MinMagnitude: 5.0, MaxDistanceKm: 250, MinExpectedMMI: 5.0},
		Informative:            Threshold{MinMagnitude: 4.0, MaxDistanceKm: 400, MinExpectedMMI: 3.0},
		ForceCriticalOnTsunami: true,
		BBox:                   geo.Box{MinLat: 16, MaxLat: 22, MinLon: -76, MaxLon: -65},
		TopicPrecision:         4,
		Validity:               5 * time.Minute,
		SWaveKmPerS:            3.5,
	}
}

func event(mag float64, tsunami bool) contract.Event {
	return contract.Event{
		ID: "6f1c2a3b-4d5e-5f60-8a7b-9c0d1e2f3a4b", SourceIDs: map[string]string{"usgs": "us7000test"},
		Type: "EARTHQUAKE", Magnitude: mag, MagType: "mww", TimeUTCms: t0, ReceivedAtMs: t0 + 3000,
		Lon: -69.9312, Lat: 18.4861, DepthKm: 10, Place: "10 km S de Santo Domingo", Tsunami: tsunami,
		SolutionStatus: "automatic",
	}
}

func signer(t *testing.T) (*LocalSigner, map[string]string) {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	s, err := NewLocalSigner("k-test-active", priv)
	if err != nil {
		t.Fatal(err)
	}
	return s, map[string]string{"k-test-active": s.PublicKeyB64()}
}

func TestStrongNearbyQuakeIsCriticalNearestFirst(t *testing.T) {
	ds := Decide(event(6.4, false), cfgDO(), t0+5000)
	if len(ds) == 0 || ds[0].Level != LevelCritical || ds[0].Topic != "alerts_DO_d7q3" {
		t.Fatalf("epicentral cell must be first and CRITICAL: %+v", ds[:min(1, len(ds))])
	}
	seenInfo := false
	for i, d := range ds {
		if d.Level == LevelInformative {
			seenInfo = true
		} else if seenInfo {
			t.Fatal("all CRITICAL decisions must precede INFORMATIVE")
		}
		if d.Level == LevelCritical && (d.Estimate.MMI < 5 || d.Cell.DistanceKm > 250) {
			t.Fatalf("critical outside thresholds: %+v", d)
		}
		if i > 0 && ds[i-1].Level == d.Level && ds[i-1].Cell.DistanceKm > d.Cell.DistanceKm {
			t.Fatal("within a level, nearest cells first")
		}
		if !strings.HasPrefix(d.Topic, "alerts_DO_") || len(d.Topic) != len("alerts_DO_")+4 {
			t.Fatalf("topic %q", d.Topic)
		}
	}
	if !seenInfo {
		t.Fatal("distant cells should receive INFORMATIVE")
	}
	if ds[0].TEASeconds < 0 || ds[0].TEASeconds > 5 {
		t.Fatalf("TEA at epicenter 5 s after origin should be ~0: %d", ds[0].TEASeconds)
	}
}

func TestSmallQuakeProducesNoAlert(t *testing.T) {
	if ds := Decide(event(3.5, false), cfgDO(), t0); len(ds) != 0 {
		t.Fatalf("M3.5 must not alert: %d decisions", len(ds))
	}
}

func TestModerateQuakeIsInformativeOnly(t *testing.T) {
	for _, d := range Decide(event(4.5, false), cfgDO(), t0) {
		if d.Level != LevelInformative {
			t.Fatalf("M4.5 below critical magnitude must never be CRITICAL: %+v", d)
		}
	}
}

func TestTsunamiFlagForcesCriticalWithinRadius(t *testing.T) {
	ds := Decide(event(4.2, true), cfgDO(), t0)
	if len(ds) == 0 {
		t.Fatal("tsunami flag must produce decisions")
	}
	for _, d := range ds {
		if d.Cell.DistanceKm <= 250 && (d.Level != LevelCritical || d.Reason != "tsunami-flag") {
			t.Fatalf("tsunami within radius must be CRITICAL: %+v", d)
		}
	}
}

func TestNonEarthquakeIgnored(t *testing.T) {
	ev := event(6.0, false)
	ev.Type = "FLOOD"
	if len(Decide(ev, cfgDO(), t0)) != 0 {
		t.Fatal("non-earthquake hazards use their own pipeline")
	}
}

func TestSignedAlertVerifiesAndClassifiesOnDevice(t *testing.T) {
	s, keys := signer(t)
	ev := event(6.4, false)
	now := t0 + 4000
	ds := Decide(ev, cfgDO(), now)
	a, err := BuildSignedAlert(ev, ds[0], cfgDO(), now, s)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(a)
	if act, why := contract.Classify(raw, now+1000, keys); act != contract.ActionAlarm {
		t.Fatalf("fresh CRITICAL must ALARM, got %s (%s)", act, why)
	}
	if act, _ := contract.Classify(raw, a.ExpMs+1, keys); act != contract.ActionInformative {
		t.Fatalf("expired alert must degrade to INFORMATIVE (anti-replay), got %s", act)
	}
	// Manipular el nivel o la instrucción rompe la firma ⇒ RECONCILE (nunca alarma falsa).
	tampered := strings.Replace(string(raw), `"instruction":"DROP_COVER_HOLD_ON"`, `"instruction":"EVACUATE_HIGH_GROUND"`, 1)
	if act, why := contract.Classify([]byte(tampered), now, keys); act != contract.ActionReconcile || why != "signature" {
		t.Fatalf("tampered payload must RECONCILE: %s %s", act, why)
	}
	if a.AlertID != contract.ComputeAlertID(ev.ID, ev.RevisionSeq) {
		t.Fatal("alert_id must be deterministic (event+revision)")
	}
	if len(raw) > 3000 {
		t.Fatalf("payload %d bytes exceeds FCM data budget (4 KB)", len(raw))
	}
	b, _ := BuildSignedAlert(ev, ds[0], cfgDO(), now+500, s)
	if b.AlertID != a.AlertID {
		t.Fatal("retries/duplicates must share alert_id (idempotency)")
	}
}

func TestTsunamiInstruction(t *testing.T) {
	s, _ := signer(t)
	ev := event(7.0, true)
	ds := Decide(ev, cfgDO(), t0)
	a, err := BuildSignedAlert(ev, ds[0], cfgDO(), t0, s)
	if err != nil || a.Instruction != "EVACUATE_HIGH_GROUND" {
		t.Fatalf("tsunami must instruct evacuation: %+v %v", a, err)
	}
}

type failingSigner struct{}

func (failingSigner) Kid() string                 { return "k-kms" }
func (failingSigner) Sign([]byte) ([]byte, error) { return nil, errors.New("kms unavailable") }

func TestSignerFailureIsReported(t *testing.T) {
	ev := event(6.4, false)
	ds := Decide(ev, cfgDO(), t0)
	if _, err := BuildSignedAlert(ev, ds[0], cfgDO(), t0, failingSigner{}); err == nil {
		t.Fatal("signing failure must surface as error (delivery degrades to RECONCILE path)")
	}
}

func TestConfigValidation(t *testing.T) {
	if err := cfgDO().Validate(); err != nil {
		t.Fatal(err)
	}
	mut := []func(*Config){
		func(c *Config) { c.Region = "do" },
		func(c *Config) { c.TopicPrecision = 7 },
		func(c *Config) { c.Validity = 30 * time.Minute },
		func(c *Config) { c.SWaveKmPerS = 0 },
		func(c *Config) { c.Critical.MinExpectedMMI = 4 },
		func(c *Config) { c.Critical.MaxDistanceKm = 900 },
	}
	for i, m := range mut {
		c := cfgDO()
		m(&c)
		if !errors.Is(c.Validate(), ErrConfig) {
			t.Errorf("mutation %d must be rejected", i)
		}
	}
}

func TestSignerConstruction(t *testing.T) {
	seed := make([]byte, 32)
	s, err := NewLocalSignerFromSeed("k-dev", base64.RawURLEncoding.EncodeToString(seed))
	if err != nil || s.Kid() != "k-dev" || len(s.PublicKeyB64()) != 43 {
		t.Fatalf("seed signer: %v", err)
	}
	if _, err := NewLocalSignerFromSeed("k-dev", "short"); !errors.Is(err, ErrConfig) {
		t.Fatal("bad seed must fail")
	}
	if _, err := NewLocalSigner("BAD KID", ed25519.NewKeyFromSeed(seed)); !errors.Is(err, ErrConfig) {
		t.Fatal("bad kid must fail")
	}
}
