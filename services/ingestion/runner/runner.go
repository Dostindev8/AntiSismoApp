// Package runner orquesta el camino crítico de ingesta: fuentes (por región, desde config) →
// pipeline en memoria → emisiones hacia decisión. Solo memoria; sin Postgres (§0.3 regla 2).
package runner

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"antisismo.app/ingestion/health"
	"antisismo.app/ingestion/pipeline"
	"antisismo.app/ingestion/regioncfg"
	"antisismo.app/ingestion/resilience"
	"antisismo.app/ingestion/sources"
	"antisismo.app/ingestion/sources/emsc"
	"antisismo.app/ingestion/sources/usgs"
	"antisismo.app/proto/contract"
)

// Emitted: evento nuevo o revisión material, listo para el motor de decisión.
type Emitted struct {
	Event  contract.Event
	Kind   pipeline.Kind
	Source string
}

const usgsFeedBase = "/earthquakes/feed/v1.0/summary/"

// BuildProviders crea los conectores de la región: USGS (primario), EMSC (respaldo) y los conectores
// oficiales pendientes como Disabled. Los hosts salen de config y pasan por la allowlist.
func BuildProviders(r *regioncfg.Region, h *health.Registry) []sources.AlertSourceProvider {
	var out []sources.AlertSourceProvider
	if s := r.Sources["usgs"]; s.Enabled {
		h.Register("usgs", r.Ops.PrimarySource == "usgs")
		client := resilience.NewHTTPClient([]string{s.Host}, 10*time.Second)
		for _, feed := range s.Feeds {
			p := usgs.NewPoller("https://"+s.Host+usgsFeedBase+feed+".geojson", time.Duration(s.PollSeconds)*time.Second, client)
			p.OnResult = func(lat time.Duration, err error) {
				if err != nil {
					h.Failure("usgs", err)
					return
				}
				h.Success("usgs", lat)
			}
			out = append(out, p)
		}
	}
	if s := r.Sources["emsc"]; s.Enabled && s.Websocket {
		h.Register(emsc.SourceName, r.Ops.PrimarySource == emsc.SourceName)
		c := emsc.NewClient(s.Host, time.Duration(s.Backoff.BaseMs)*time.Millisecond, time.Duration(s.Backoff.MaxMs)*time.Millisecond)
		c.OnStatus = func(err error) {
			if err != nil {
				h.Failure(emsc.SourceName, err)
				return
			}
			h.Success(emsc.SourceName, 0)
		}
		out = append(out, c)
	}
	for _, d := range r.DisabledSources() {
		out = append(out, sources.Disabled{SourceName: d[0], Note: d[1]})
	}
	return out
}

type Runner struct {
	Pipeline  *pipeline.Pipeline
	Health    *health.Registry
	Providers []sources.AlertSourceProvider
	Out       chan<- Emitted
	Log       *slog.Logger
	// Watchdog: cada cuánto se evalúa la salud (alarma > ops.sourceDownAlarmSeconds).
	Watchdog  time.Duration
	PruneEach time.Duration
	Now       func() time.Time
	// RestartDelay: espera antes de relanzar un conector que terminó o entró en pánico.
	RestartDelay time.Duration
}

// Run bloquea hasta que ctx se cancele. Un conector que falla o entra en pánico se reinicia sin
// afectar a los demás: la caída de una fuente nunca silencia a las otras.
func (r *Runner) Run(ctx context.Context) error {
	if r.Log == nil {
		r.Log = slog.Default()
	}
	if r.Now == nil {
		r.Now = time.Now
	}
	if r.Watchdog <= 0 {
		r.Watchdog = 5 * time.Second
	}
	if r.PruneEach <= 0 {
		r.PruneEach = time.Hour
	}
	if r.RestartDelay <= 0 {
		r.RestartDelay = time.Second
	}
	obs := make(chan sources.Observation, 1024)
	var wg sync.WaitGroup
	for _, p := range r.Providers {
		if !p.Enabled() {
			r.Log.Info("source disabled", "source", p.Name())
			continue
		}
		wg.Add(1)
		go func(p sources.AlertSourceProvider) {
			defer wg.Done()
			r.supervise(ctx, p, obs)
		}(p)
	}
	defer wg.Wait()

	watch := time.NewTicker(r.Watchdog)
	defer watch.Stop()
	prune := time.NewTicker(r.PruneEach)
	defer prune.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-watch.C:
			r.Health.Check()
		case <-prune.C:
			r.Pipeline.Prune(r.Now().UnixMilli())
		case o := <-obs:
			r.Health.Event(o.Source)
			ev, kind := r.Pipeline.Ingest(o)
			if kind == pipeline.KindNone {
				continue
			}
			select {
			case r.Out <- Emitted{Event: ev, Kind: kind, Source: o.Source}:
			case <-ctx.Done():
				return ctx.Err()
			}
		}
	}
}

func (r *Runner) supervise(ctx context.Context, p sources.AlertSourceProvider, out chan<- sources.Observation) {
	for ctx.Err() == nil {
		err := r.runSafe(ctx, p, out)
		if ctx.Err() != nil {
			return
		}
		r.Health.Failure(p.Name(), err)
		r.Log.Warn("source stopped; restarting", "source", p.Name(), "error", fmt.Sprint(err))
		if resilience.Sleep(ctx, r.RestartDelay) != nil {
			return
		}
	}
}

func (r *Runner) runSafe(ctx context.Context, p sources.AlertSourceProvider, out chan<- sources.Observation) (err error) {
	defer func() {
		if rec := recover(); rec != nil {
			err = fmt.Errorf("panic: %v", rec)
		}
	}()
	return p.Run(ctx, out)
}
