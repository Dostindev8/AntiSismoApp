// Package pipeline: estado en memoria del camino crítico (sin Postgres). Deduplica observaciones
// multi-fuente, asigna revision_seq monótono y emite solo cambios materiales.
package pipeline

import (
	"math"
	"sync"
	"time"

	"antisismo.app/ingestion/normalize"
	"antisismo.app/ingestion/sources"
	"antisismo.app/proto/contract"
)

// Kind describe qué emitir hacia decisión/entrega.
type Kind int

const (
	KindNone     Kind = iota // duplicado sin cambios materiales: no emitir
	KindNew                  // evento nuevo (revision 0)
	KindRevision             // cambio material: nueva revisión (actualiza tarjeta, sin alarma nueva si ya se alarmó)
)

type Revision struct {
	Seq       int
	Magnitude float64
	Lat, Lon  float64
	DepthKm   float64
	Status    string
	AtMs      int64
}

type tracked struct {
	ev          contract.Event
	primary     string           // fuente autorizada a revisar parámetros
	lastUpdated map[string]int64 // por fuente
	history     []Revision
}

type Pipeline struct {
	mu        sync.Mutex
	dedup     normalize.DedupConfig
	retention time.Duration
	events    []*tracked
	bySource  map[string]*tracked // "usgs:us7000abcd" → evento
}

func New(dedup normalize.DedupConfig, retention time.Duration) *Pipeline {
	return &Pipeline{dedup: dedup, retention: retention, bySource: map[string]*tracked{}}
}

// materialChange: umbrales mínimos para considerar una revisión (evita fatiga por ruido de redondeo).
func materialChange(a, b *contract.Event) bool {
	return math.Abs(a.Magnitude-b.Magnitude) >= 0.1 ||
		normalize.HaversineKm(a.Lat, a.Lon, b.Lat, b.Lon) >= 1 ||
		math.Abs(a.DepthKm-b.DepthKm) >= 1 ||
		a.SolutionStatus != b.SolutionStatus ||
		a.Tsunami != b.Tsunami
}

// Ingest procesa una observación y devuelve el evento resultante (copia) y el tipo de emisión.
func (p *Pipeline) Ingest(o sources.Observation) (contract.Event, Kind) {
	p.mu.Lock()
	defer p.mu.Unlock()

	key := o.Source + ":" + o.SourceID
	t := p.bySource[key]
	if t == nil {
		known := make([]*contract.Event, len(p.events))
		for i, e := range p.events {
			known[i] = &e.ev
		}
		if dup := normalize.FindDuplicate(&o.Event, known, p.dedup); dup != nil {
			for _, e := range p.events {
				if &e.ev == dup {
					t = e
					break
				}
			}
		}
	}

	if t == nil {
		ev := o.Event
		ev.RevisionSeq = 0
		ev.SourceIDs = map[string]string{o.Source: o.SourceID}
		t = &tracked{ev: ev, primary: o.Source, lastUpdated: map[string]int64{o.Source: o.SourceUpdatedMs}}
		t.history = append(t.history, snapshot(&ev))
		p.events = append(p.events, t)
		p.bySource[key] = t
		return cloneEvent(t.ev), KindNew
	}

	p.bySource[key] = t
	normalize.MergeSourceIDs(t.ev.SourceIDs, map[string]string{o.Source: o.SourceID})
	if prev, ok := t.lastUpdated[o.Source]; ok && o.SourceUpdatedMs <= prev {
		return cloneEvent(t.ev), KindNone // reporte viejo o repetido de la misma fuente
	}
	t.lastUpdated[o.Source] = o.SourceUpdatedMs

	// Solo la fuente primaria o una solución revisada actualiza parámetros: una fuente automática
	// secundaria solo aporta su source_id (evita revisiones espurias y fatiga de alertas).
	reviewed := o.Event.SolutionStatus == "reviewed"
	if t.ev.SolutionStatus == "reviewed" && !reviewed {
		return cloneEvent(t.ev), KindNone
	}
	if o.Source != t.primary && !reviewed {
		return cloneEvent(t.ev), KindNone
	}
	if !materialChange(&t.ev, &o.Event) {
		return cloneEvent(t.ev), KindNone
	}
	if reviewed {
		t.primary = o.Source
	}
	t.ev.Magnitude, t.ev.MagType = o.Event.Magnitude, o.Event.MagType
	t.ev.Lat, t.ev.Lon, t.ev.DepthKm = o.Event.Lat, o.Event.Lon, o.Event.DepthKm
	t.ev.SolutionStatus = o.Event.SolutionStatus
	t.ev.Tsunami = t.ev.Tsunami || o.Event.Tsunami // un aviso de tsunami nunca se degrada por una fuente
	if o.Event.Place != "" {
		t.ev.Place = o.Event.Place
	}
	t.ev.ReceivedAtMs = o.Event.ReceivedAtMs
	t.ev.RevisionSeq++
	t.history = append(t.history, snapshot(&t.ev))
	return cloneEvent(t.ev), KindRevision
}

// History devuelve el historial de revisiones (p. ej. 6.4 → 6.2) de un evento.
func (p *Pipeline) History(eventID string) []Revision {
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, t := range p.events {
		if t.ev.ID == eventID {
			return append([]Revision(nil), t.history...)
		}
	}
	return nil
}

// Prune elimina eventos más viejos que la retención (memoria acotada ante 100× tráfico).
func (p *Pipeline) Prune(nowMs int64) int {
	p.mu.Lock()
	defer p.mu.Unlock()
	cutoff := nowMs - p.retention.Milliseconds()
	kept := p.events[:0]
	removed := 0
	for _, t := range p.events {
		if t.ev.TimeUTCms >= cutoff {
			kept = append(kept, t)
			continue
		}
		removed++
		for k, v := range p.bySource {
			if v == t {
				delete(p.bySource, k)
			}
		}
	}
	for i := len(kept); i < len(p.events); i++ {
		p.events[i] = nil
	}
	p.events = kept
	return removed
}

func snapshot(e *contract.Event) Revision {
	return Revision{Seq: e.RevisionSeq, Magnitude: e.Magnitude, Lat: e.Lat, Lon: e.Lon, DepthKm: e.DepthKm, Status: e.SolutionStatus, AtMs: e.ReceivedAtMs}
}

func cloneEvent(e contract.Event) contract.Event {
	ids := make(map[string]string, len(e.SourceIDs))
	for k, v := range e.SourceIDs {
		ids[k] = v
	}
	e.SourceIDs = ids
	return e
}
