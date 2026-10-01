// Package contract es el espejo Go de packages/proto/schemas (fuente de verdad del wire format).
package contract

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"unicode/utf16"
)

const (
	// MinEpochMs = 2000-01-01T00:00:00Z. Un valor menor casi seguro viene en segundos.
	MinEpochMs      int64 = 946_684_800_000
	maxEpochMs      int64 = 32_503_680_000_000
	MaxFutureSkewMs int64 = 5 * 60 * 1000
	MaxPlaceUnits         = 200
)

var ErrInvalid = errors.New("invalid event")

var (
	reUUID    = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$`)
	reSrcKey  = regexp.MustCompile(`^[a-z][a-z0-9_]{1,15}$`)
	reSrcVal  = regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,64}$`)
	reMagType = regexp.MustCompile(`^[A-Za-z_]{1,8}$`)
	reUnsafe  = regexp.MustCompile(`[\x00-\x1F\x7F<>]`)
	hazardSet = map[string]bool{"EARTHQUAKE": true, "TSUNAMI": true, "VOLCANO": true, "FLOOD": true, "LANDSLIDE": true, "WILDFIRE": true, "CIVIL": true}
	statusSet = map[string]bool{"automatic": true, "reviewed": true}
)

// Event = NormalizedEvent (wire snake_case). Tiempos en epoch MILISEGUNDOS UTC.
type Event struct {
	ID             string            `json:"id"`
	SourceIDs      map[string]string `json:"source_ids"`
	Type           string            `json:"type"`
	Magnitude      float64           `json:"magnitude"`
	MagType        string            `json:"mag_type"`
	TimeUTCms      int64             `json:"time_utc_ms"`
	ReceivedAtMs   int64             `json:"received_at_ms"`
	Lon            float64           `json:"lon"`
	Lat            float64           `json:"lat"`
	DepthKm        float64           `json:"depth_km"`
	Place          string            `json:"place"`
	Tsunami        bool              `json:"tsunami"`
	SolutionStatus string            `json:"solution_status"`
	RevisionSeq    int               `json:"revision_seq"`
}

// UTF16Len cuenta unidades UTF-16 (misma métrica que JS/Dart String.length) para que el
// límite de 200 sea idéntico en Go, TypeScript y Dart.
func UTF16Len(s string) int {
	n := 0
	for _, r := range s {
		n += len(utf16.Encode([]rune{r}))
	}
	return n
}

// Validate aplica rangos y reglas cruzadas. GeoJSON = [lon, lat, depth]; los rangos detectan
// lon/lat invertidos cuando |lon| > 90.
func (e *Event) Validate() error {
	fail := func(f string) error { return fmt.Errorf("%w: %s", ErrInvalid, f) }
	switch {
	case !reUUID.MatchString(e.ID):
		return fail("id")
	case len(e.SourceIDs) == 0:
		return fail("source_ids")
	case !hazardSet[e.Type]:
		return fail("type")
	case e.Magnitude < -2 || e.Magnitude > 10:
		return fail("magnitude")
	case !reMagType.MatchString(e.MagType):
		return fail("mag_type")
	case e.TimeUTCms < MinEpochMs || e.TimeUTCms > maxEpochMs:
		return fail("time_utc_ms")
	case e.ReceivedAtMs < MinEpochMs || e.ReceivedAtMs > maxEpochMs:
		return fail("received_at_ms")
	case e.TimeUTCms > e.ReceivedAtMs+MaxFutureSkewMs:
		return fail("time_utc_ms in future")
	case e.Lat < -90 || e.Lat > 90:
		return fail("lat")
	case e.Lon < -180 || e.Lon > 180:
		return fail("lon")
	case e.DepthKm < -100 || e.DepthKm > 1000:
		return fail("depth_km")
	case UTF16Len(e.Place) > MaxPlaceUnits || reUnsafe.MatchString(e.Place):
		return fail("place")
	case !statusSet[e.SolutionStatus]:
		return fail("solution_status")
	case e.RevisionSeq < 0 || e.RevisionSeq > 10_000:
		return fail("revision_seq")
	}
	for k, v := range e.SourceIDs {
		if !reSrcKey.MatchString(k) || !reSrcVal.MatchString(v) {
			return fail("source_ids entry")
		}
	}
	return nil
}

var requiredEventKeys = []string{
	"id", "source_ids", "type", "magnitude", "mag_type", "time_utc_ms", "received_at_ms",
	"lon", "lat", "depth_km", "place", "tsunami", "solution_status", "revision_seq",
}

// DecodeEvent decodifica de forma estricta (campos desconocidos, ausentes o de tipo erróneo ⇒ error) y valida.
func DecodeEvent(data []byte) (*Event, error) {
	var present map[string]json.RawMessage
	if err := json.Unmarshal(data, &present); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	for _, k := range requiredEventKeys {
		if _, ok := present[k]; !ok {
			return nil, fmt.Errorf("%w: missing %s", ErrInvalid, k)
		}
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	var e Event
	if err := dec.Decode(&e); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	if err := e.Validate(); err != nil {
		return nil, err
	}
	return &e, nil
}
