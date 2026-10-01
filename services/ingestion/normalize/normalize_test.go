package normalize

import (
	"errors"
	"math"
	"strings"
	"testing"
	"unicode/utf8"

	"antisismo.app/proto/contract"
)

func ev(id string, mag float64, tMs int64, lat, lon float64, src map[string]string) *contract.Event {
	return &contract.Event{
		ID: id, SourceIDs: src, Type: "EARTHQUAKE", Magnitude: mag, MagType: "Mw",
		TimeUTCms: tMs, ReceivedAtMs: tMs + 2500, Lat: lat, Lon: lon, DepthKm: 35,
		Place: "RD", SolutionStatus: "automatic",
	}
}

const t0 int64 = 1790627527000

func TestHaversineKnownDistances(t *testing.T) {
	// Santo Domingo ↔ Santiago de los Caballeros ≈ 134 km; 1° de latitud ≈ 111.195 km.
	if d := HaversineKm(18.4861, -69.9312, 19.4517, -70.6970); math.Abs(d-134) > 10 {
		t.Fatalf("SD-Santiago = %.1f km", d)
	}
	if d := HaversineKm(0, 0, 1, 0); math.Abs(d-111.195) > 0.01 {
		t.Fatalf("1 deg lat = %.3f km", d)
	}
	if d := HaversineKm(10, 179.9, 10, -179.9); d > 25 {
		t.Fatalf("antimeridian distance %.1f km too large", d)
	}
	if d := HaversineKm(0, 0, 0, 180); math.IsNaN(d) {
		t.Fatal("antipodal NaN")
	}
}

func TestValidateRejectsSwappedAndSeconds(t *testing.T) {
	swapped := ev(EventID("usgs", "a"), 5.9, t0, -99.1, 16.9, map[string]string{"usgs": "a"})
	if err := swapped.Validate(); !errors.Is(err, contract.ErrInvalid) {
		t.Fatalf("swapped lon/lat must be invalid, got %v", err)
	}
	secs := ev(EventID("usgs", "b"), 5.9, t0/1000, 18.5, -69.9, map[string]string{"usgs": "b"})
	secs.ReceivedAtMs = t0
	if err := secs.Validate(); !errors.Is(err, contract.ErrInvalid) {
		t.Fatalf("epoch in seconds must be invalid, got %v", err)
	}
}

func TestDedupDoesNotMergeDistantMagnitudes(t *testing.T) {
	a := ev("a", 4.0, t0, 19.7, -69.9, nil)
	b := ev("b", 5.8, t0+10_000, 19.7+60/111.195, -69.9, nil) // 60 km, 10 s, ΔM=1.8
	if FindDuplicate(b, []*contract.Event{a}, DefaultDedup) != nil {
		t.Fatal("ΔM > 1.5 must not merge")
	}
}

func TestDedupPicksClosestCandidate(t *testing.T) {
	far := ev("far", 6.0, t0+12_000, 19.7+80/111.195, -69.9, nil)
	near := ev("near", 6.1, t0+2_000, 19.7+5/111.195, -69.9, nil)
	in := ev("in", 6.2, t0, 19.7, -69.9, nil)
	if got := FindDuplicate(in, []*contract.Event{far, near}, DefaultDedup); got == nil || got.ID != "near" {
		t.Fatalf("expected near, got %+v", got)
	}
}

func TestDedupWindowBoundaries(t *testing.T) {
	base := ev("base", 6.0, t0, 19.7, -69.9, nil)
	edge := ev("edge", 6.0, t0+16_000, 19.7, -69.9, nil)
	out := ev("out", 6.0, t0+16_001, 19.7, -69.9, nil)
	if FindDuplicate(edge, []*contract.Event{base}, DefaultDedup) == nil {
		t.Fatal("exactly 16 s must merge")
	}
	if FindDuplicate(out, []*contract.Event{base}, DefaultDedup) != nil {
		t.Fatal(">16 s must not merge")
	}
}

func TestUSGSPlusEMSCSameEventYieldsOne(t *testing.T) {
	usgs := ev(EventID("usgs", "us7000abcd"), 6.8, t0, 19.70, -69.90, map[string]string{"usgs": "us7000abcd"})
	emsc := ev(EventID("emsc", "20260928_0000123"), 6.7, t0+3_000, 19.74, -69.85, map[string]string{"emsc": "20260928_0000123"})
	known := []*contract.Event{usgs}
	dup := FindDuplicate(emsc, known, DefaultDedup)
	if dup == nil {
		t.Fatal("same event from USGS+EMSC must dedup to one")
	}
	MergeSourceIDs(dup.SourceIDs, emsc.SourceIDs)
	if len(dup.SourceIDs) != 2 || dup.SourceIDs["emsc"] != "20260928_0000123" {
		t.Fatalf("source_ids not preserved: %v", dup.SourceIDs)
	}
}

func TestEventIDDeterministicUUIDv5(t *testing.T) {
	a, b := EventID("usgs", "us7000abcd"), EventID("usgs", "us7000abcd")
	if a != b || a == EventID("emsc", "us7000abcd") {
		t.Fatal("EventID must be deterministic and source-scoped")
	}
	e := ev(a, 5, t0, 18, -70, map[string]string{"usgs": "x"})
	if err := e.Validate(); err != nil {
		t.Fatalf("EventID must be a valid UUID: %s %v", a, err)
	}
}

func TestSanitizePlaceQA16(t *testing.T) {
	in := "<script>alert(1)</script>" + strings.Repeat("A", 5000)
	out := SanitizePlace(in)
	if strings.ContainsAny(out, "<>") || contract.UTF16Len(out) > 200 || !utf8.ValidString(out) {
		t.Fatalf("unsafe output: %q", out)
	}
	if got := SanitizePlace("  22 km\tal N\nde  Puerto Plata\x07 "); got != "22 km al N de Puerto Plata" {
		t.Fatalf("got %q", got)
	}
	emoji := strings.Repeat("🌎", 150)
	if u := contract.UTF16Len(SanitizePlace(emoji)); u > 200 || u%2 != 0 {
		t.Fatalf("emoji truncation broke surrogate pairs: %d units", u)
	}
	if got := SanitizePlace("\xff\xfeRD"); got != "RD" {
		t.Fatalf("invalid utf8 not cleaned: %q", got)
	}
}
