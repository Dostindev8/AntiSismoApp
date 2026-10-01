// Package normalize: distancia, sanitización y deduplicación multi-fuente (§7.1, §3#16).
package normalize

import (
	"crypto/sha1"
	"fmt"
	"math"
	"strings"
	"unicode"
	"unicode/utf8"

	"antisismo.app/proto/contract"
)

const earthRadiusKm = 6371.0088

// DedupConfig viene de packages/config/regions/<R>.yaml (dedup).
type DedupConfig struct {
	WindowMs    int64
	RadiusKm    float64
	MaxDeltaMag float64
}

var DefaultDedup = DedupConfig{WindowMs: 16_000, RadiusKm: 100, MaxDeltaMag: 1.5}

func HaversineKm(lat1, lon1, lat2, lon2 float64) float64 {
	rad := func(d float64) float64 { return d * math.Pi / 180 }
	dLat, dLon := rad(lat2-lat1), rad(lon2-lon1)
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(rad(lat1))*math.Cos(rad(lat2))*math.Sin(dLon/2)*math.Sin(dLon/2)
	return 2 * earthRadiusKm * math.Asin(math.Min(1, math.Sqrt(a)))
}

// FindDuplicate devuelve el candidato con menor distancia espacio-temporal normalizada, o nil.
// Nunca fusiona si |Δmag| > MaxDeltaMag (réplica cercana ≠ mismo evento).
func FindDuplicate(ev *contract.Event, known []*contract.Event, cfg DedupConfig) *contract.Event {
	var best *contract.Event
	bestScore := math.MaxFloat64
	for _, k := range known {
		dt := math.Abs(float64(k.TimeUTCms - ev.TimeUTCms))
		if dt > float64(cfg.WindowMs) {
			continue
		}
		d := HaversineKm(k.Lat, k.Lon, ev.Lat, ev.Lon)
		if d > cfg.RadiusKm || math.Abs(k.Magnitude-ev.Magnitude) > cfg.MaxDeltaMag {
			continue
		}
		score := dt/float64(cfg.WindowMs) + d/cfg.RadiusKm
		if score < bestScore {
			best, bestScore = k, score
		}
	}
	return best
}

// MergeSourceIDs conserva todos los source_ids (trazabilidad) sin sobrescribir los existentes.
func MergeSourceIDs(dst, src map[string]string) {
	for k, v := range src {
		if _, ok := dst[k]; !ok {
			dst[k] = v
		}
	}
}

// SanitizePlace trata el texto de fuentes externas como no confiable (QA-16): elimina caracteres
// de control y '<' '>', colapsa espacios y trunca a 200 unidades UTF-16 sin cortar runas.
func SanitizePlace(raw string) string {
	if !utf8.ValidString(raw) {
		raw = strings.ToValidUTF8(raw, "")
	}
	var b strings.Builder
	units, prevSpace := 0, false
	for _, r := range raw {
		if r == '<' || r == '>' || unicode.IsControl(r) || r == '\u2028' || r == '\u2029' {
			r = ' '
		}
		if unicode.IsSpace(r) {
			if prevSpace || b.Len() == 0 {
				continue
			}
			r, prevSpace = ' ', true
		} else {
			prevSpace = false
		}
		w := 1
		if r > 0xFFFF {
			w = 2
		}
		if units+w > contract.MaxPlaceUnits {
			break
		}
		b.WriteRune(r)
		units += w
	}
	return strings.TrimRight(b.String(), " ")
}

// EventID genera un UUID v5 determinista a partir de la primera fuente que reporta el evento,
// de modo que un reinicio del servicio no crea alertas nuevas para el mismo evento (idempotencia).
func EventID(source, sourceID string) string {
	ns := [16]byte{0x6b, 0xa7, 0xb8, 0x11, 0x9d, 0xad, 0x11, 0xd1, 0x80, 0xb4, 0x00, 0xc0, 0x4f, 0xd4, 0x30, 0xc8} // namespace URL (RFC 4122)
	h := sha1.New()
	h.Write(ns[:])
	h.Write([]byte("antisismo:" + source + ":" + sourceID))
	s := h.Sum(nil)
	s[6] = (s[6] & 0x0f) | 0x50
	s[8] = (s[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", s[0:4], s[4:6], s[6:8], s[8:10], s[10:16])
}
