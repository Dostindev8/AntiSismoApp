// Package health: salud por fuente (source_health §17) y alarma operativa cuando una fuente deja de
// responder más de DownAfter. La alarma informa a operaciones; nunca detiene ni silencia el pipeline.
// Las métricas se exponen en formato de texto Prometheus (el OTel Collector las ingiere con su
// receptor prometheus; ver docs/adr/0007-observabilidad.md).
package health

import (
	"fmt"
	"io"
	"log/slog"
	"sort"
	"strings"
	"sync"
	"time"
)

type state struct {
	primary       bool
	registeredMs  int64
	up            bool
	lastSuccessMs int64
	lastEventMs   int64
	lastLatencyMs int64
	lastError     string
	failures      int64
	events        int64
	alarmed       bool
	alarms        int64
}

// Alarm: fuente sin éxito durante más de DownAfter.
type Alarm struct {
	Source    string
	Primary   bool
	DownForMs int64
}

type Status struct {
	Source        string `json:"source"`
	Primary       bool   `json:"primary"`
	Up            bool   `json:"up"`
	LastSuccessMs int64  `json:"last_success_ms"`
	LastEventMs   int64  `json:"last_event_ms"`
	LatencyMs     int64  `json:"latency_ms"`
	Failures      int64  `json:"failures"`
	Events        int64  `json:"events"`
	Alarmed       bool   `json:"alarmed"`
}

type Registry struct {
	mu        sync.Mutex
	now       func() time.Time
	downAfter time.Duration
	log       *slog.Logger
	sources   map[string]*state
}

func NewRegistry(downAfter time.Duration, log *slog.Logger, now func() time.Time) *Registry {
	if now == nil {
		now = time.Now
	}
	if log == nil {
		log = slog.Default()
	}
	return &Registry{now: now, downAfter: downAfter, log: log, sources: map[string]*state{}}
}

func (r *Registry) Register(source string, primary bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.sources[source]; !ok {
		r.sources[source] = &state{primary: primary, registeredMs: r.now().UnixMilli()}
	}
}

func (r *Registry) get(source string) *state {
	s, ok := r.sources[source]
	if !ok {
		s = &state{registeredMs: r.now().UnixMilli()}
		r.sources[source] = s
	}
	return s
}

// Success: la fuente respondió (aunque no haya eventos nuevos, p. ej. HTTP 304 o pong).
func (r *Registry) Success(source string, latency time.Duration) {
	r.mu.Lock()
	defer r.mu.Unlock()
	s := r.get(source)
	s.up, s.lastSuccessMs, s.lastLatencyMs, s.lastError = true, r.now().UnixMilli(), latency.Milliseconds(), ""
	if s.alarmed {
		s.alarmed = false
		r.log.Info("source recovered", "event", "source_recovered", "source", source, "primary", s.primary)
	}
}

func (r *Registry) Failure(source string, err error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	s := r.get(source)
	s.up, s.failures = false, s.failures+1
	if err != nil {
		s.lastError = err.Error()
	}
}

// Event: se recibió una observación válida de la fuente.
func (r *Registry) Event(source string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	s := r.get(source)
	now := r.now().UnixMilli()
	s.events++
	s.lastEventMs, s.lastSuccessMs, s.up = now, now, true
}

// Check evalúa todas las fuentes. Registra un log ERROR estructurado una vez por caída (sin spam) y
// devuelve las alarmas activas para el exportador.
func (r *Registry) Check() []Alarm {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := r.now().UnixMilli()
	var out []Alarm
	for name, s := range r.sources {
		ref := s.lastSuccessMs
		if ref == 0 {
			ref = s.registeredMs
		}
		down := now - ref
		if down <= r.downAfter.Milliseconds() {
			continue
		}
		s.up = false
		out = append(out, Alarm{Source: name, Primary: s.primary, DownForMs: down})
		if !s.alarmed {
			s.alarmed = true
			s.alarms++
			r.log.Error("source down", "event", "source_down_alarm", "source", name, "primary", s.primary,
				"down_for_ms", down, "last_error", s.lastError)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Source < out[j].Source })
	return out
}

func (r *Registry) Snapshot() []Status {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]Status, 0, len(r.sources))
	for name, s := range r.sources {
		out = append(out, Status{name, s.primary, s.up, s.lastSuccessMs, s.lastEventMs, s.lastLatencyMs, s.failures, s.events, s.alarmed})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Source < out[j].Source })
	return out
}

func b2i(b bool) int {
	if b {
		return 1
	}
	return 0
}

// WritePrometheus escribe las métricas source_health en formato de exposición de texto.
func (r *Registry) WritePrometheus(w io.Writer) error {
	snap := r.Snapshot()
	r.mu.Lock()
	alarms := map[string]int64{}
	for n, s := range r.sources {
		alarms[n] = s.alarms
	}
	r.mu.Unlock()
	var b strings.Builder
	metric := func(name, typ, help string, val func(Status) string) {
		fmt.Fprintf(&b, "# HELP %s %s\n# TYPE %s %s\n", name, help, name, typ)
		for _, s := range snap {
			fmt.Fprintf(&b, "%s{source=%q,primary=\"%t\"} %s\n", name, s.Source, s.Primary, val(s))
		}
	}
	metric("antisismo_source_up", "gauge", "1 si la fuente respondio dentro de la ventana de salud.", func(s Status) string { return fmt.Sprint(b2i(s.Up)) })
	metric("antisismo_source_down_alarm", "gauge", "1 si la fuente lleva caida mas que el umbral configurado.", func(s Status) string { return fmt.Sprint(b2i(s.Alarmed)) })
	metric("antisismo_source_last_success_ms", "gauge", "Epoch ms UTC de la ultima respuesta exitosa.", func(s Status) string { return fmt.Sprint(s.LastSuccessMs) })
	metric("antisismo_source_last_event_ms", "gauge", "Epoch ms UTC de la ultima observacion valida.", func(s Status) string { return fmt.Sprint(s.LastEventMs) })
	metric("antisismo_source_latency_ms", "gauge", "Latencia de la ultima consulta exitosa.", func(s Status) string { return fmt.Sprint(s.LatencyMs) })
	metric("antisismo_source_failures_total", "counter", "Fallos de consulta o conexion.", func(s Status) string { return fmt.Sprint(s.Failures) })
	metric("antisismo_source_events_total", "counter", "Observaciones validas recibidas.", func(s Status) string { return fmt.Sprint(s.Events) })
	metric("antisismo_source_down_alarms_total", "counter", "Caidas que dispararon alarma operativa.", func(s Status) string { return fmt.Sprint(alarms[s.Source]) })
	_, err := io.WriteString(w, b.String())
	return err
}
