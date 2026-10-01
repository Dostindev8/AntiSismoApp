// Package regioncfg carga packages/config/regions/{CODE}.yaml (misma fuente que el schema zod de
// packages/config/src/region.ts) y aplica las mismas invariantes. Umbrales y hosts nunca en código.
package regioncfg

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"time"

	"go.yaml.in/yaml/v3"

	"antisismo.app/ingestion/normalize"
)

var (
	reCode     = regexp.MustCompile(`^[A-Z]{2}$`)
	reLocale   = regexp.MustCompile(`^[a-z]{2}-[A-Z]{2}$`)
	reEmerg    = regexp.MustCompile(`^\d{3,4}$`)
	reHostname = regexp.MustCompile(`^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$`)
	usgsFeeds  = []string{"all_hour", "significant_week", "all_day", "significant_day"}
)

type Threshold struct {
	MinMagnitude   float64 `yaml:"minMagnitude"`
	MaxDistanceKm  float64 `yaml:"maxDistanceKm"`
	MinExpectedMMI float64 `yaml:"minExpectedMMI"`
}

type Backoff struct {
	BaseMs int  `yaml:"baseMs"`
	MaxMs  int  `yaml:"maxMs"`
	Jitter bool `yaml:"jitter"`
}

// Source cubre usgs, emsc y conectores deshabilitados (solo enabled+note).
type Source struct {
	Enabled     bool     `yaml:"enabled"`
	Host        string   `yaml:"host"`
	PollSeconds int      `yaml:"pollSeconds"`
	Feeds       []string `yaml:"feeds"`
	Websocket   bool     `yaml:"websocket"`
	Backoff     *Backoff `yaml:"backoff"`
	Note        string   `yaml:"note"`
}

type Region struct {
	Region          string `yaml:"region"`
	Name            string `yaml:"name"`
	Timezone        string `yaml:"timezone"`
	Locale          string `yaml:"locale"`
	EmergencyNumber string `yaml:"emergencyNumber"`
	BBox            struct {
		MinLat float64 `yaml:"minLat"`
		MaxLat float64 `yaml:"maxLat"`
		MinLon float64 `yaml:"minLon"`
		MaxLon float64 `yaml:"maxLon"`
	} `yaml:"bbox"`
	Thresholds struct {
		Critical    Threshold `yaml:"critical"`
		Informative Threshold `yaml:"informative"`
	} `yaml:"thresholds"`
	Tsunami struct {
		ForceCriticalOnFlag bool `yaml:"forceCriticalOnFlag"`
	} `yaml:"tsunami"`
	Sources map[string]Source `yaml:"sources"`
	Dedup   struct {
		WindowMs    int64   `yaml:"windowMs"`
		RadiusKm    float64 `yaml:"radiusKm"`
		MaxDeltaMag float64 `yaml:"maxDeltaMag"`
	} `yaml:"dedup"`
	Ops struct {
		PrimarySource          string `yaml:"primarySource"`
		SourceDownAlarmSeconds int    `yaml:"sourceDownAlarmSeconds"`
	} `yaml:"ops"`
}

var ErrInvalid = errors.New("regioncfg: invalid region config")

func invalid(format string, a ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalid, fmt.Sprintf(format, a...))
}

// Parse decodifica de forma estricta (campos desconocidos = error) y valida invariantes.
func Parse(data []byte) (*Region, error) {
	dec := yaml.NewDecoder(bytes.NewReader(data))
	dec.KnownFields(true)
	var r Region
	if err := dec.Decode(&r); err != nil {
		return nil, invalid("%v", err)
	}
	if err := r.Validate(); err != nil {
		return nil, err
	}
	return &r, nil
}

// Load lee {dir}/{code}.yaml y exige que el archivo declare esa región.
func Load(dir, code string) (*Region, error) {
	if !reCode.MatchString(code) {
		return nil, invalid("region code %q", code)
	}
	data, err := os.ReadFile(filepath.Join(dir, code+".yaml"))
	if err != nil {
		return nil, err
	}
	r, err := Parse(data)
	if err != nil {
		return nil, err
	}
	if r.Region != code {
		return nil, invalid("file %s.yaml declares region %s", code, r.Region)
	}
	return r, nil
}

func (r *Region) Validate() error {
	switch {
	case !reCode.MatchString(r.Region):
		return invalid("region")
	case len(r.Name) < 2:
		return invalid("name")
	case !reLocale.MatchString(r.Locale):
		return invalid("locale")
	case !reEmerg.MatchString(r.EmergencyNumber):
		return invalid("emergencyNumber")
	}
	if _, err := time.LoadLocation(r.Timezone); err != nil || r.Timezone == "" || r.Timezone == "Local" {
		return invalid("timezone %q", r.Timezone)
	}
	b := r.BBox
	if b.MinLat < -90 || b.MaxLat > 90 || b.MinLon < -180 || b.MaxLon > 180 || b.MinLat >= b.MaxLat || b.MinLon >= b.MaxLon {
		return invalid("bbox")
	}
	c, i := r.Thresholds.Critical, r.Thresholds.Informative
	for _, t := range []Threshold{c, i} {
		if t.MinMagnitude < 0 || t.MinMagnitude > 10 || t.MaxDistanceKm <= 0 || t.MaxDistanceKm > 20000 || t.MinExpectedMMI < 1 || t.MinExpectedMMI > 12 {
			return invalid("threshold out of range")
		}
	}
	switch {
	case c.MinMagnitude < i.MinMagnitude:
		return invalid("critical.minMagnitude must be >= informative.minMagnitude")
	case c.MaxDistanceKm > i.MaxDistanceKm:
		return invalid("critical.maxDistanceKm must be <= informative.maxDistanceKm")
	case c.MinExpectedMMI < 5:
		return invalid("CRITICAL requires expected MMI >= V")
	}
	if err := r.validateSources(); err != nil {
		return err
	}
	d := r.Dedup
	if d.WindowMs <= 0 || d.WindowMs > 60_000 || d.RadiusKm <= 0 || d.RadiusKm > 500 || d.MaxDeltaMag <= 0 || d.MaxDeltaMag > 3 {
		return invalid("dedup")
	}
	o := r.Ops
	if o.SourceDownAlarmSeconds < 10 || o.SourceDownAlarmSeconds > 600 {
		return invalid("ops.sourceDownAlarmSeconds")
	}
	if p, ok := r.Sources[o.PrimarySource]; !ok || !p.Enabled || (o.PrimarySource != "usgs" && o.PrimarySource != "emsc") {
		return invalid("ops.primarySource must be an enabled source")
	}
	return nil
}

func (r *Region) validateSources() error {
	usgs, ok := r.Sources["usgs"]
	if !ok {
		return invalid("sources.usgs missing")
	}
	if !reHostname.MatchString(usgs.Host) || usgs.PollSeconds < 30 || len(usgs.Feeds) == 0 {
		return invalid("sources.usgs (host/pollSeconds>=30/feeds)")
	}
	for _, f := range usgs.Feeds {
		if !slices.Contains(usgsFeeds, f) {
			return invalid("sources.usgs feed %q", f)
		}
	}
	emsc, ok := r.Sources["emsc"]
	if !ok {
		return invalid("sources.emsc missing")
	}
	if !reHostname.MatchString(emsc.Host) || emsc.Backoff == nil || emsc.Backoff.BaseMs <= 0 || emsc.Backoff.MaxMs < emsc.Backoff.BaseMs || !emsc.Backoff.Jitter {
		return invalid("sources.emsc (host/backoff with jitter)")
	}
	for name, s := range r.Sources {
		if name == "usgs" || name == "emsc" {
			continue
		}
		// Conectores oficiales sin documentación verificada: nunca habilitados, nunca con host inventado.
		if s.Enabled || len([]rune(s.Note)) < 10 || s.Host != "" || s.Feeds != nil || s.Backoff != nil {
			return invalid("source %s must be disabled with a note", name)
		}
	}
	return nil
}

// AllowedHosts: allowlist anti-SSRF = hosts de fuentes habilitadas.
func (r *Region) AllowedHosts() []string {
	var out []string
	for _, name := range []string{"usgs", "emsc"} {
		if s := r.Sources[name]; s.Enabled {
			out = append(out, s.Host)
		}
	}
	return out
}

func (r *Region) DedupConfig() normalize.DedupConfig {
	return normalize.DedupConfig{WindowMs: r.Dedup.WindowMs, RadiusKm: r.Dedup.RadiusKm, MaxDeltaMag: r.Dedup.MaxDeltaMag}
}

// DisabledSources devuelve los conectores pendientes (nombre → nota), ordenados.
func (r *Region) DisabledSources() [][2]string {
	var out [][2]string
	for name, s := range r.Sources {
		if !s.Enabled && name != "usgs" && name != "emsc" {
			out = append(out, [2]string{name, s.Note})
		}
	}
	slices.SortFunc(out, func(a, b [2]string) int {
		if a[0] < b[0] {
			return -1
		}
		if a[0] > b[0] {
			return 1
		}
		return 0
	})
	return out
}
