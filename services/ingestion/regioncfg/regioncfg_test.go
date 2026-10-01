package regioncfg

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"antisismo.app/ingestion/normalize"
)

const dir = "../../../packages/config/regions"

func TestLoadsSharedRegionFiles(t *testing.T) {
	for _, code := range []string{"DO", "MX"} {
		r, err := Load(dir, code)
		if err != nil {
			t.Fatalf("%s: %v", code, err)
		}
		if r.Ops.PrimarySource != "usgs" || r.Ops.SourceDownAlarmSeconds != 60 {
			t.Fatalf("%s ops: %+v", code, r.Ops)
		}
		if r.DedupConfig() != normalize.DefaultDedup {
			t.Fatalf("%s dedup differs from contract default: %+v", code, r.DedupConfig())
		}
		hosts := strings.Join(r.AllowedHosts(), ",")
		if hosts != "earthquake.usgs.gov,www.seismicportal.eu" {
			t.Fatalf("%s allowlist: %s", code, hosts)
		}
		for _, d := range r.DisabledSources() {
			if r.Sources[d[0]].Enabled {
				t.Fatalf("%s: %s must stay disabled", code, d[0])
			}
		}
	}
	r, _ := Load(dir, "DO")
	if r.Timezone != "America/Santo_Domingo" || r.EmergencyNumber != "911" || len(r.DisabledSources()) != 3 {
		t.Fatalf("DO: %+v", r)
	}
}

func TestRejectsDangerousConfigs(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join(dir, "DO.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	base := strings.ReplaceAll(string(raw), "\r\n", "\n")
	if _, err := Parse([]byte(base)); err != nil {
		t.Fatalf("baseline must be valid: %v", err)
	}
	cases := map[string][2]string{
		"poll too fast":       {"pollSeconds: 30", "pollSeconds: 5"},
		"critical MMI < V":    {"minExpectedMMI: 5.0", "minExpectedMMI: 4.0"},
		"ssrf host":           {"host: earthquake.usgs.gov", "host: 169.254.169.254"},
		"enable unverified":   {"enabled: false\n    note: \"Centro", "enabled: true\n    note: \"Centro"},
		"unknown field":       {"region: DO", "region: DO\nextra: 1"},
		"bad timezone":        {"America/Santo_Domingo", "Mars/Olympus"},
		"bad feed":            {"[all_hour, significant_week]", "[all_hour, everything]"},
		"no jitter":           {"jitter: true", "jitter: false"},
		"alarm too slow":      {"sourceDownAlarmSeconds: 60", "sourceDownAlarmSeconds: 3600"},
		"primary not enabled": {"primarySource: usgs", "primarySource: cns_do"},
		"crit dist > inf":     {"maxDistanceKm: 250", "maxDistanceKm: 900"},
		"bbox inverted":       {"minLat: 16.0", "minLat: 30.0"},
	}
	for name, c := range cases {
		mut := strings.Replace(base, c[0], c[1], 1)
		if mut == base {
			t.Fatalf("%s: patch did not apply", name)
		}
		if _, err := Parse([]byte(mut)); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: expected ErrInvalid, got %v", name, err)
		}
	}
}

func TestLoadGuards(t *testing.T) {
	if _, err := Load(dir, "../DO"); !errors.Is(err, ErrInvalid) {
		t.Fatal("path traversal in region code must be rejected")
	}
	if _, err := Load(dir, "ZZ"); err == nil {
		t.Fatal("missing region must fail")
	}
	tmp := t.TempDir()
	data, _ := os.ReadFile(filepath.Join(dir, "MX.yaml"))
	_ = os.WriteFile(filepath.Join(tmp, "DO.yaml"), data, 0o600)
	if _, err := Load(tmp, "DO"); !errors.Is(err, ErrInvalid) {
		t.Fatal("file declaring another region must be rejected")
	}
}
