package health

import (
	"bytes"
	"errors"
	"log/slog"
	"strings"
	"testing"
	"time"
)

type clock struct{ t time.Time }

func (c *clock) now() time.Time { return c.t }

func newReg() (*Registry, *clock, *bytes.Buffer) {
	c := &clock{t: time.UnixMilli(1790627527000)}
	var logs bytes.Buffer
	r := NewRegistry(60*time.Second, slog.New(slog.NewJSONHandler(&logs, nil)), c.now)
	return r, c, &logs
}

func TestPrimaryDownMoreThan60sRaisesOneAlarm(t *testing.T) {
	r, c, logs := newReg()
	r.Register("usgs", true)
	r.Register("emsc", false)
	r.Success("usgs", 120*time.Millisecond)
	r.Success("emsc", 0)

	c.t = c.t.Add(60 * time.Second)
	if a := r.Check(); len(a) != 0 {
		t.Fatalf("exactly 60 s is not an outage yet: %+v", a)
	}
	r.Success("emsc", 0)
	r.Failure("usgs", errors.New("503"))
	c.t = c.t.Add(1 * time.Second)
	a := r.Check()
	if len(a) != 1 || a[0].Source != "usgs" || !a[0].Primary || a[0].DownForMs != 61_000 {
		t.Fatalf("expected primary alarm, got %+v", a)
	}
	c.t = c.t.Add(5 * time.Second)
	if a := r.Check(); len(a) != 1 {
		t.Fatalf("alarm must stay active while down: %+v", a)
	}
	if n := strings.Count(logs.String(), `"event":"source_down_alarm"`); n != 1 {
		t.Fatalf("alarm must be logged once per outage (no spam), got %d\n%s", n, logs)
	}
	if !strings.Contains(logs.String(), `"last_error":"503"`) {
		t.Fatalf("structured log must include the last error: %s", logs)
	}

	r.Success("usgs", 80*time.Millisecond)
	if a := r.Check(); len(a) != 0 {
		t.Fatalf("recovered source must clear alarm: %+v", a)
	}
	if !strings.Contains(logs.String(), `"event":"source_recovered"`) {
		t.Fatal("recovery must be logged")
	}
}

func TestNeverSeenSourceAlarmsFromRegistration(t *testing.T) {
	r, c, _ := newReg()
	r.Register("usgs", true)
	c.t = c.t.Add(61 * time.Second)
	if a := r.Check(); len(a) != 1 || a[0].Source != "usgs" {
		t.Fatalf("a source that never answered must alarm: %+v", a)
	}
}

func TestEventCountsAsSuccess(t *testing.T) {
	r, c, _ := newReg()
	r.Register("emsc", false)
	c.t = c.t.Add(30 * time.Second)
	r.Event("emsc")
	c.t = c.t.Add(59 * time.Second)
	if a := r.Check(); len(a) != 0 {
		t.Fatalf("recent event keeps source healthy: %+v", a)
	}
	s := r.Snapshot()
	if len(s) != 1 || s[0].Events != 1 || !s[0].Up || s[0].LastEventMs != 1790627557000 {
		t.Fatalf("snapshot: %+v", s)
	}
}

func TestPrometheusExposition(t *testing.T) {
	r, c, _ := newReg()
	r.Register("usgs", true)
	r.Success("usgs", 250*time.Millisecond)
	r.Failure("usgs", nil)
	c.t = c.t.Add(2 * time.Minute)
	r.Check()
	var b bytes.Buffer
	if err := r.WritePrometheus(&b); err != nil {
		t.Fatal(err)
	}
	out := b.String()
	for _, want := range []string{
		"# TYPE antisismo_source_up gauge",
		`antisismo_source_up{source="usgs",primary="true"} 0`,
		`antisismo_source_down_alarm{source="usgs",primary="true"} 1`,
		`antisismo_source_latency_ms{source="usgs",primary="true"} 250`,
		`antisismo_source_failures_total{source="usgs",primary="true"} 1`,
		`antisismo_source_down_alarms_total{source="usgs",primary="true"} 1`,
		`antisismo_source_last_success_ms{source="usgs",primary="true"} 1790627527000`,
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in:\n%s", want, out)
		}
	}
}

func TestDefaultsAndUnknownSource(t *testing.T) {
	r := NewRegistry(time.Minute, nil, nil)
	r.Failure("nueva", errors.New("x"))
	if s := r.Snapshot(); len(s) != 1 || s[0].Up || s[0].Failures != 1 {
		t.Fatalf("unknown source must be tracked: %+v", s)
	}
}
