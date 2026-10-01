package geo

import (
	"encoding/json"
	"errors"
	"math"
	"os"
	"strings"
	"testing"
)

type vectors struct {
	Encode []struct {
		Lat, Lon  float64
		Precision int
		Hash      string
	} `json:"encode"`
	Invalid []struct {
		Lat, Lon  float64
		Precision int
	} `json:"invalid"`
}

func load(t *testing.T) vectors {
	t.Helper()
	b, err := os.ReadFile("../../fixtures/geohash-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var v vectors
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func TestSharedVectors(t *testing.T) {
	v := load(t)
	for _, c := range v.Encode {
		h, err := Encode(c.Lat, c.Lon, c.Precision)
		if err != nil || h != c.Hash {
			t.Errorf("Encode(%v,%v,%d)=%q,%v want %q", c.Lat, c.Lon, c.Precision, h, err, c.Hash)
		}
		box, err := Decode(h)
		if err != nil {
			t.Fatal(err)
		}
		if c.Lat < box.MinLat || c.Lat > box.MaxLat || c.Lon < box.MinLon || c.Lon > box.MaxLon {
			t.Errorf("decoded box %+v does not contain %v,%v", box, c.Lat, c.Lon)
		}
	}
	for _, c := range v.Invalid {
		if _, err := Encode(c.Lat, c.Lon, c.Precision); !errors.Is(err, ErrRange) {
			t.Errorf("expected ErrRange for %+v", c)
		}
	}
	if _, err := Encode(math.NaN(), 0, 4); !errors.Is(err, ErrRange) {
		t.Error("NaN must be rejected")
	}
}

func TestDecodeRejectsInvalid(t *testing.T) {
	for _, h := range []string{"", "aaaa", "d7q8!", strings.Repeat("d", 13)} {
		if _, err := Decode(h); !errors.Is(err, ErrRange) {
			t.Errorf("Decode(%q) must fail", h)
		}
	}
}

func TestCellSizePrecision4(t *testing.T) {
	dLat, dLon := CellSize(4)
	if dLat != 0.17578125 || dLon != 0.3515625 {
		t.Fatalf("gh4 = %v × %v", dLat, dLon)
	}
}

func TestHaversineKnownDistance(t *testing.T) {
	// Santo Domingo ↔ Santiago de los Caballeros ≈ 124 km en línea recta.
	d := HaversineKm(18.4861, -69.9312, 19.4517, -70.697)
	if d < 120 || d > 135 {
		t.Fatalf("distance %v", d)
	}
	if HaversineKm(10, 10, 10, 10) != 0 {
		t.Fatal("zero distance")
	}
}

func TestCellsWithinAreSortedUniqueAndInRadius(t *testing.T) {
	bbox := Box{MinLat: 16, MaxLat: 22, MinLon: -76, MaxLon: -65}
	cells := CellsWithin(18.4861, -69.9312, 100, 4, bbox)
	if len(cells) < 20 || len(cells) > 200 {
		t.Fatalf("unexpected cell count %d", len(cells))
	}
	seen := map[string]bool{}
	for i, c := range cells {
		if seen[c.Hash] || len(c.Hash) != 4 || c.DistanceKm > 100 {
			t.Fatalf("bad cell %+v", c)
		}
		seen[c.Hash] = true
		if i > 0 && c.DistanceKm < cells[i-1].DistanceKm {
			t.Fatal("cells must be sorted by distance (nearest first)")
		}
		box, _ := Decode(c.Hash)
		la, lo := box.Center()
		if math.Abs(la-c.Lat) > 1e-9 || math.Abs(lo-c.Lon) > 1e-9 {
			t.Fatalf("cell center mismatch %+v vs %v,%v", c, la, lo)
		}
	}
	if h, _ := Encode(18.4861, -69.9312, 4); cells[0].Hash != h {
		t.Fatalf("epicenter cell must be first: %s vs %s", cells[0].Hash, h)
	}
	if got := CellsWithin(0, 0, 50, 4, bbox); len(got) != 0 {
		t.Fatalf("far epicenter must yield no cells in bbox, got %d", len(got))
	}
}
