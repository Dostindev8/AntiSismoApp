// Package usgs: poller del feed GeoJSON de USGS (§3#15). El feed se refresca ~1/min y hoy responde
// Last-Modified + Cache-Control:max-age=60 (sin ETag): se usa If-Modified-Since, y If-None-Match si aparece ETag.
package usgs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"sync/atomic"
	"time"

	"antisismo.app/ingestion/normalize"
	"antisismo.app/ingestion/resilience"
	"antisismo.app/ingestion/sources"
	"antisismo.app/proto/contract"
)

const maxBodyBytes = 8 << 20

var reMagType = regexp.MustCompile(`^[A-Za-z_]{1,8}$`)

type feed struct {
	Features []json.RawMessage `json:"features"`
}

type feature struct {
	ID         string `json:"id"`
	Properties struct {
		Mag     *float64 `json:"mag"`
		Place   *string  `json:"place"`
		Time    *int64   `json:"time"`
		Updated *int64   `json:"updated"`
		Status  string   `json:"status"`
		Tsunami int      `json:"tsunami"`
		MagType *string  `json:"magType"`
		Type    string   `json:"type"`
	} `json:"properties"`
	Geometry struct {
		Type        string    `json:"type"`
		Coordinates []float64 `json:"coordinates"`
	} `json:"geometry"`
}

// Stats: contadores expuestos como métricas (QA-21: descartes con métrica, sin caer el pipeline).
type Stats struct {
	Parsed, Skipped, Rejected, NotModified, FetchErrors atomic.Int64
}

// Parse convierte el FeatureCollection en observaciones válidas. Un feature malformado se descarta
// y se cuenta; nunca invalida el resto del lote.
func Parse(body []byte, receivedAtMs int64, st *Stats) ([]sources.Observation, error) {
	var fc feed
	if err := json.Unmarshal(body, &fc); err != nil {
		return nil, fmt.Errorf("usgs: feed not decodable: %w", err)
	}
	out := make([]sources.Observation, 0, len(fc.Features))
	for _, raw := range fc.Features {
		var f feature
		if err := json.Unmarshal(raw, &f); err != nil {
			st.Rejected.Add(1)
			continue
		}
		p := f.Properties
		if p.Type != "earthquake" || p.Status == "deleted" {
			st.Skipped.Add(1)
			continue
		}
		if f.ID == "" || p.Mag == nil || p.Time == nil || f.Geometry.Type != "Point" || len(f.Geometry.Coordinates) < 3 {
			st.Rejected.Add(1)
			continue
		}
		magType := "unk"
		if p.MagType != nil && reMagType.MatchString(*p.MagType) {
			magType = *p.MagType
		}
		place := ""
		if p.Place != nil {
			place = normalize.SanitizePlace(*p.Place)
		}
		status := "automatic"
		if p.Status == "reviewed" {
			status = "reviewed"
		}
		updated := *p.Time
		if p.Updated != nil {
			updated = *p.Updated
		}
		c := f.Geometry.Coordinates // GeoJSON = [lon, lat, depth]
		ev := contract.Event{
			ID:             normalize.EventID("usgs", f.ID),
			SourceIDs:      map[string]string{"usgs": f.ID},
			Type:           "EARTHQUAKE",
			Magnitude:      *p.Mag,
			MagType:        magType,
			TimeUTCms:      *p.Time,
			ReceivedAtMs:   receivedAtMs,
			Lon:            c[0],
			Lat:            c[1],
			DepthKm:        c[2],
			Place:          place,
			Tsunami:        p.Tsunami == 1,
			SolutionStatus: status,
		}
		if err := ev.Validate(); err != nil {
			st.Rejected.Add(1)
			continue
		}
		st.Parsed.Add(1)
		out = append(out, sources.Observation{Source: "usgs", SourceID: f.ID, SourceUpdatedMs: updated, Event: ev})
	}
	return out, nil
}

// Poller consulta un feed con peticiones condicionales, breaker y backoff.
type Poller struct {
	URL      string
	Interval time.Duration
	Client   *http.Client
	Breaker  *resilience.Breaker
	Backoff  *resilience.Backoff
	Now      func() time.Time
	Stats    Stats
	// OnResult informa la salud de cada consulta (nil = sin reporte). 304 cuenta como éxito.
	OnResult func(latency time.Duration, err error)

	etag, lastModified string
}

func (p *Poller) Name() string  { return "usgs" }
func (p *Poller) Enabled() bool { return true }

func NewPoller(url string, interval time.Duration, client *http.Client) *Poller {
	return &Poller{
		URL: url, Interval: interval, Client: client,
		Breaker: resilience.NewBreaker(5, 60*time.Second),
		Backoff: resilience.NewBackoff(500*time.Millisecond, 30*time.Second),
		Now:     time.Now,
	}
}

var ErrStatus = errors.New("usgs: unexpected status")

// Fetch hace una petición condicional. notModified=true en 304 (sin trabajo nuevo).
func (p *Poller) Fetch(ctx context.Context) (obs []sources.Observation, notModified bool, err error) {
	if err := p.Breaker.Allow(); err != nil {
		return nil, false, err
	}
	defer func() { p.Breaker.Record(err) }()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, p.URL, nil)
	if err != nil {
		return nil, false, err
	}
	req.Header.Set("Accept", "application/geo+json, application/json")
	req.Header.Set("User-Agent", "AntiSismo-Ingestion/0.1 (+https://antisismo.app)")
	if p.etag != "" {
		req.Header.Set("If-None-Match", p.etag)
	}
	if p.lastModified != "" {
		req.Header.Set("If-Modified-Since", p.lastModified)
	}
	resp, err := p.Client.Do(req)
	if err != nil {
		p.Stats.FetchErrors.Add(1)
		return nil, false, err
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusNotModified:
		p.Stats.NotModified.Add(1)
		return nil, true, nil
	case http.StatusOK:
	default:
		p.Stats.FetchErrors.Add(1)
		return nil, false, fmt.Errorf("%w: %d", ErrStatus, resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBodyBytes+1))
	if err != nil {
		p.Stats.FetchErrors.Add(1)
		return nil, false, err
	}
	if len(body) > maxBodyBytes {
		p.Stats.FetchErrors.Add(1)
		return nil, false, errors.New("usgs: body too large")
	}
	obs, err = Parse(body, p.Now().UnixMilli(), &p.Stats)
	if err != nil {
		p.Stats.FetchErrors.Add(1)
		return nil, false, err
	}
	p.etag = resp.Header.Get("ETag")
	p.lastModified = resp.Header.Get("Last-Modified")
	return obs, false, nil
}

// Run emite observaciones cada Interval; en error espera con backoff+jitter (nunca martilla la fuente).
func (p *Poller) Run(ctx context.Context, out chan<- sources.Observation) error {
	for {
		start := p.Now()
		obs, _, err := p.Fetch(ctx)
		if p.OnResult != nil && ctx.Err() == nil {
			p.OnResult(p.Now().Sub(start), err)
		}
		wait := p.Interval
		if err != nil {
			wait = p.Backoff.Next()
		} else {
			p.Backoff.Reset()
			for _, o := range obs {
				select {
				case out <- o:
				case <-ctx.Done():
					return ctx.Err()
				}
			}
		}
		if err := resilience.Sleep(ctx, wait); err != nil {
			return err
		}
	}
}
