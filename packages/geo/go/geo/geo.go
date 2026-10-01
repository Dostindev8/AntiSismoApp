// Package geo: geohash y distancias compartidos por decisión/entrega. El dispositivo calcula su
// celda localmente (apps/mobile/lib/core/geo/geohash.dart, mismos vectores en packages/geo/fixtures)
// y solo se suscribe al topic de celda gruesa: el servidor nunca recibe coordenadas exactas.
package geo

import (
	"errors"
	"math"
	"sort"
	"strings"
)

const base32 = "0123456789bcdefghjkmnpqrstuvwxyz"

var ErrRange = errors.New("geo: coordinate out of range")

// Encode devuelve el geohash de precisión p (1..12).
func Encode(lat, lon float64, p int) (string, error) {
	if lat < -90 || lat > 90 || lon < -180 || lon > 180 || math.IsNaN(lat) || math.IsNaN(lon) || p < 1 || p > 12 {
		return "", ErrRange
	}
	latR, lonR := [2]float64{-90, 90}, [2]float64{-180, 180}
	var b strings.Builder
	bit, ch, even := 0, 0, true
	for b.Len() < p {
		if even {
			mid := (lonR[0] + lonR[1]) / 2
			if lon >= mid {
				ch |= 1 << (4 - bit)
				lonR[0] = mid
			} else {
				lonR[1] = mid
			}
		} else {
			mid := (latR[0] + latR[1]) / 2
			if lat >= mid {
				ch |= 1 << (4 - bit)
				latR[0] = mid
			} else {
				latR[1] = mid
			}
		}
		even = !even
		if bit < 4 {
			bit++
			continue
		}
		b.WriteByte(base32[ch])
		bit, ch = 0, 0
	}
	return b.String(), nil
}

// Box es la celda [MinLat,MaxLat]×[MinLon,MaxLon] de un geohash.
type Box struct{ MinLat, MaxLat, MinLon, MaxLon float64 }

func (b Box) Center() (lat, lon float64) { return (b.MinLat + b.MaxLat) / 2, (b.MinLon + b.MaxLon) / 2 }

func Decode(hash string) (Box, error) {
	if len(hash) < 1 || len(hash) > 12 {
		return Box{}, ErrRange
	}
	latR, lonR := [2]float64{-90, 90}, [2]float64{-180, 180}
	even := true
	for i := 0; i < len(hash); i++ {
		v := strings.IndexByte(base32, hash[i])
		if v < 0 {
			return Box{}, ErrRange
		}
		for bit := 4; bit >= 0; bit-- {
			on := v>>bit&1 == 1
			r := &latR
			if even {
				r = &lonR
			}
			mid := (r[0] + r[1]) / 2
			if on {
				r[0] = mid
			} else {
				r[1] = mid
			}
			even = !even
		}
	}
	return Box{latR[0], latR[1], lonR[0], lonR[1]}, nil
}

// CellSize devuelve el tamaño en grados (lat, lon) de una celda de precisión p.
func CellSize(p int) (dLat, dLon float64) {
	bits := 5 * p
	lonBits := (bits + 1) / 2
	latBits := bits / 2
	return 180 / math.Pow(2, float64(latBits)), 360 / math.Pow(2, float64(lonBits))
}

// HaversineKm: distancia de gran círculo (radio medio terrestre 6371.0088 km, IUGG).
func HaversineKm(lat1, lon1, lat2, lon2 float64) float64 {
	const r = 6371.0088
	rad := func(d float64) float64 { return d * math.Pi / 180 }
	dLat, dLon := rad(lat2-lat1), rad(lon2-lon1)
	a := math.Sin(dLat/2)*math.Sin(dLat/2) + math.Cos(rad(lat1))*math.Cos(rad(lat2))*math.Sin(dLon/2)*math.Sin(dLon/2)
	return 2 * r * math.Asin(math.Min(1, math.Sqrt(a)))
}

// Cell: celda candidata con la distancia de su centro al epicentro.
type Cell struct {
	Hash       string
	Lat, Lon   float64
	DistanceKm float64
}

// CellsWithin enumera las celdas de precisión p dentro de bbox cuyo centro está a ≤ radiusKm.
// Orden: distancia ascendente (las celdas más cercanas, con menos tiempo de aviso, salen primero).
func CellsWithin(lat, lon, radiusKm float64, p int, bbox Box) []Cell {
	dLat, dLon := CellSize(p)
	var out []Cell
	startLat := math.Floor((bbox.MinLat+90)/dLat)*dLat - 90
	startLon := math.Floor((bbox.MinLon+180)/dLon)*dLon - 180
	for la := startLat; la < bbox.MaxLat; la += dLat {
		for lo := startLon; lo < bbox.MaxLon; lo += dLon {
			cLat, cLon := la+dLat/2, lo+dLon/2
			if cLat < -90 || cLat > 90 || cLon < -180 || cLon > 180 {
				continue
			}
			d := HaversineKm(lat, lon, cLat, cLon)
			if d > radiusKm {
				continue
			}
			h, err := Encode(cLat, cLon, p)
			if err != nil {
				continue
			}
			out = append(out, Cell{Hash: h, Lat: cLat, Lon: cLon, DistanceKm: d})
		}
	}
	sortCells(out)
	return out
}

func sortCells(c []Cell) {
	sort.Slice(c, func(i, j int) bool {
		if c[i].DistanceKm != c[j].DistanceKm {
			return c[i].DistanceKm < c[j].DistanceKm
		}
		return c[i].Hash < c[j].Hash
	})
}
