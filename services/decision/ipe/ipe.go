// Package ipe: ecuación de predicción de intensidad (IPE) usada por el motor de decisión.
//
// Allen, T. I., Wald, D. J. and Worden, C. B. (2012). Intensity attenuation for active crustal
// regions. J. Seismology 16: 409–433. Versión por distancia hipocentral (Rhyp), coeficientes tal como
// los implementa OpenQuake (openquake/hazardlib/gsim/allen_2012_ipe.py, clase AllenEtAl2012Rhypo):
//
//	MMI = c0 + c1·M + c2·ln(√(Rhyp² + Rm²)) [+ c4·ln(Rhyp/50) si Rhyp > 50 km]
//	Rm  = m1 + m2·exp(M − 5)
//	σ   = s1 + s2 / (1 + (Rhyp/s3)²)
//
// Rango de validez publicado: Mw 5.0–7.9, Rhyp < 300 km, cortical activa. Fuera de rango el valor es
// una extrapolación: Valid=false y el motor lo trata como informativo salvo umbral explícito.
package ipe

import "math"

const (
	c0, c1, c2, c4 = 2.085, 1.428, -1.402, 0.078
	m1, m2         = -0.209, 2.042
	s1, s2, s3     = 0.82, 0.37, 22.9
)

type Estimate struct {
	MMI, Sigma float64
	Low, High  float64 // MMI ± 1σ, recortado a [1, 12]
	Valid      bool    // dentro del rango de validez publicado
}

func clamp(v float64) float64 { return math.Max(1, math.Min(12, v)) }

// AllenEtAl2012Rhypo estima la intensidad media para magnitud mag a distancia hipocentral rhypKm.
func AllenEtAl2012Rhypo(mag, rhypKm float64) Estimate {
	r := math.Max(rhypKm, 0)
	rm := m1 + m2*math.Exp(mag-5)
	f := c2 * math.Log(math.Sqrt(r*r+rm*rm))
	if r > 50 {
		f += c4 * math.Log(r/50)
	}
	mmi := c0 + c1*mag + f
	sigma := s1 + s2/(1+math.Pow(r/s3, 2))
	return Estimate{
		MMI: clamp(mmi), Sigma: sigma, Low: clamp(mmi - sigma), High: clamp(mmi + sigma),
		Valid: mag >= 5.0 && mag <= 7.9 && r < 300,
	}
}

// HypocentralKm combina distancia epicentral y profundidad.
func HypocentralKm(epicentralKm, depthKm float64) float64 {
	return math.Sqrt(epicentralKm*epicentralKm + depthKm*depthKm)
}
