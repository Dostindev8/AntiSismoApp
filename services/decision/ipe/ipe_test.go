package ipe

import (
	"math"
	"testing"
)

func near(a, b, tol float64) bool { return math.Abs(a-b) <= tol }

// Valores calculados a mano con la fórmula publicada (ver comentario del paquete).
func TestReferenceValues(t *testing.T) {
	e := AllenEtAl2012Rhypo(6.5, 20)
	if !near(e.MMI, 7.039, 0.01) || !near(e.Sigma, 1.030, 0.01) || !e.Valid {
		t.Fatalf("M6.5 @20km: %+v", e)
	}
	e = AllenEtAl2012Rhypo(6.5, 100) // incluye término anelástico (>50 km)
	if !near(e.MMI, 4.959, 0.01) {
		t.Fatalf("M6.5 @100km: %+v", e)
	}
	if !near(e.Low, e.MMI-e.Sigma, 1e-9) || !near(e.High, e.MMI+e.Sigma, 1e-9) {
		t.Fatalf("range must be ±1σ: %+v", e)
	}
}

func TestMonotonicity(t *testing.T) {
	prev := 13.0
	for r := 5.0; r <= 300; r += 5 {
		m := AllenEtAl2012Rhypo(6.0, r).MMI
		if m > prev+1e-9 {
			t.Fatalf("intensity must not grow with distance (r=%v)", r)
		}
		prev = m
	}
	if AllenEtAl2012Rhypo(7.0, 50).MMI <= AllenEtAl2012Rhypo(6.0, 50).MMI {
		t.Fatal("intensity must grow with magnitude")
	}
}

func TestClampAndValidity(t *testing.T) {
	if e := AllenEtAl2012Rhypo(9.5, 0); e.MMI > 12 || e.High > 12 || e.Valid {
		t.Fatalf("must clamp to XII and flag extrapolation: %+v", e)
	}
	if e := AllenEtAl2012Rhypo(3.0, 900); e.MMI < 1 || e.Low < 1 || e.Valid {
		t.Fatalf("must clamp to I and flag extrapolation: %+v", e)
	}
	if e := AllenEtAl2012Rhypo(6.0, -5); e.MMI != AllenEtAl2012Rhypo(6.0, 0).MMI {
		t.Fatal("negative distance treated as zero")
	}
	if HypocentralKm(30, 40) != 50 {
		t.Fatal("hypocentral distance")
	}
}
