package contract

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

var fixturesDir = filepath.Join("..", "..", "fixtures")

type eventFixtures struct {
	Valid []struct {
		Name  string          `json:"name"`
		Event json.RawMessage `json:"event"`
	} `json:"valid"`
	Invalid []struct {
		Name  string          `json:"name"`
		Event json.RawMessage `json:"event"`
	} `json:"invalid"`
}

type alertVectors struct {
	Canonical struct {
		EventID     string `json:"event_id"`
		RevisionSeq int    `json:"revision_seq"`
		AlertID     string `json:"alert_id"`
		String      string `json:"string"`
	} `json:"canonical"`
	PublicKeys map[string]string `json:"public_keys"`
	Cases      []struct {
		Name   string          `json:"name"`
		NowMs  int64           `json:"now_ms"`
		Expect Action          `json:"expect"`
		Alert  json.RawMessage `json:"alert"`
	} `json:"cases"`
}

func load(t *testing.T, name string, v any) {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(fixturesDir, name))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(b, v); err != nil {
		t.Fatal(err)
	}
}

func TestEpochErrata(t *testing.T) {
	got := time.UnixMilli(1790627527000).UTC()
	if got.Format(time.RFC3339) != "2026-09-28T20:32:07Z" || got.Weekday() != time.Monday {
		t.Fatalf("epoch errata mismatch: %s %s", got, got.Weekday())
	}
	loc, err := time.LoadLocation("America/Santo_Domingo")
	if err != nil {
		t.Skipf("tzdata not available: %v", err)
	}
	if l := got.In(loc).Format("15:04:05"); l != "16:32:07" {
		t.Fatalf("local time = %s", l)
	}
}

func TestEventFixtures(t *testing.T) {
	var f eventFixtures
	load(t, "events.json", &f)
	for _, v := range f.Valid {
		if _, err := DecodeEvent(v.Event); err != nil {
			t.Errorf("valid %s rejected: %v", v.Name, err)
		}
	}
	for _, v := range f.Invalid {
		if _, err := DecodeEvent(v.Event); err == nil {
			t.Errorf("invalid %s accepted", v.Name)
		}
	}
}

func TestAlertVectors(t *testing.T) {
	var v alertVectors
	load(t, "alert-vectors.json", &v)
	if got := ComputeAlertID(v.Canonical.EventID, v.Canonical.RevisionSeq); got != v.Canonical.AlertID {
		t.Fatalf("alert_id = %s want %s", got, v.Canonical.AlertID)
	}
	seen := map[Action]bool{}
	for _, c := range v.Cases {
		got, reason := Classify(c.Alert, c.NowMs, v.PublicKeys)
		seen[got] = true
		if got != c.Expect {
			t.Errorf("%s: got %s (%s) want %s", c.Name, got, reason, c.Expect)
		}
		if c.Name == "valid-critical" {
			a, err := DecodeSignedAlert(c.Alert)
			if err != nil {
				t.Fatal(err)
			}
			if a.CanonicalString() != v.Canonical.String {
				t.Errorf("canonical mismatch:\n%q\n%q", a.CanonicalString(), v.Canonical.String)
			}
		}
	}
	for _, a := range []Action{ActionAlarm, ActionInformative, ActionDrill, ActionReconcile} {
		if !seen[a] {
			t.Errorf("vectors do not cover %s", a)
		}
	}
}

func TestSignRoundTrip(t *testing.T) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	a := SignedAlert{
		V: 1, Level: "CRITICAL", Instruction: "DROP_COVER_HOLD_ON", Kid: "k-rt",
		IatMs: 1790627529000, ExpMs: 1790627829000, ServerTimeMs: 1790627529100,
		Event: AlertEvent{ID: "3f6c2a1e-8b4d-4c1a-9e2f-7a5b6c8d9e01", Type: "EARTHQUAKE", Magnitude: 6.8, MagType: "Mw",
			TimeUTCms: 1790627527000, SolutionStatus: "automatic"},
	}
	a.AlertID = ComputeAlertID(a.Event.ID, a.Event.RevisionSeq)
	a.Sign(priv)
	keys := map[string]string{"k-rt": base64.RawURLEncoding.EncodeToString(pub)}
	b, _ := json.Marshal(a)
	if got, reason := Classify(b, a.IatMs+1, keys); got != ActionAlarm {
		t.Fatalf("round trip: %s (%s)", got, reason)
	}
	a.Level = "INFORMATIVE" // alteración posterior a la firma
	b, _ = json.Marshal(a)
	if got, _ := Classify(b, a.IatMs+1, keys); got != ActionReconcile {
		t.Fatalf("tampered level must RECONCILE, got %s", got)
	}
}

func TestUTF16Len(t *testing.T) {
	if UTF16Len("República") != 9 || UTF16Len("🌎") != 2 {
		t.Fatal("UTF16Len mismatch with JS/Dart String.length")
	}
}
