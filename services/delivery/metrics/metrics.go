// Package metrics: métricas del camino crítico (§17): latency_e2e, delivery_rate, DLQ, degradación.
// Formato de texto Prometheus; el OTel Collector las recoge con su receptor prometheus (ADR-0007).
package metrics

import (
	"fmt"
	"io"
	"slices"
	"sync"
	"sync/atomic"
)

// Window guarda las últimas N muestras para cuantiles exactos (p50/p99) sin dependencias externas.
type Window struct {
	mu   sync.Mutex
	buf  []int64
	next int
	full bool
}

func NewWindow(n int) *Window { return &Window{buf: make([]int64, n)} }

func (w *Window) Observe(v int64) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.buf[w.next] = v
	w.next = (w.next + 1) % len(w.buf)
	if w.next == 0 {
		w.full = true
	}
}

// Quantile devuelve el cuantil q ∈ [0,1] por rango más cercano; ok=false sin muestras.
func (w *Window) Quantile(q float64) (int64, bool) {
	w.mu.Lock()
	n := w.next
	if w.full {
		n = len(w.buf)
	}
	s := slices.Clone(w.buf[:n])
	w.mu.Unlock()
	if len(s) == 0 {
		return 0, false
	}
	slices.Sort(s)
	idx := int(q*float64(len(s))+0.999999) - 1
	return s[max(0, min(idx, len(s)-1))], true
}

func (w *Window) Count() int {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.full {
		return len(w.buf)
	}
	return w.next
}

type Delivery struct {
	LatencyE2E     *Window // evento recibido → aceptado por FCM (ms)
	QueueToSend    *Window // encolado → aceptado por FCM (ms)
	Sent           atomic.Int64
	Failed         atomic.Int64
	Retries        atomic.Int64
	DLQ            atomic.Int64
	SignFailures   atomic.Int64
	QueueDegraded  atomic.Bool
	TransportReady atomic.Bool
}

func NewDelivery() *Delivery {
	return &Delivery{LatencyE2E: NewWindow(10_000), QueueToSend: NewWindow(10_000)}
}

func (d *Delivery) WritePrometheus(w io.Writer) error {
	var err error
	p := func(format string, a ...any) {
		if err == nil {
			_, err = fmt.Fprintf(w, format, a...)
		}
	}
	for _, s := range []struct {
		name, help string
		win        *Window
	}{
		{"antisismo_latency_e2e_ms", "Evento recibido a aceptado por el proveedor push.", d.LatencyE2E},
		{"antisismo_queue_to_send_ms", "Encolado a aceptado por el proveedor push.", d.QueueToSend},
	} {
		p("# HELP %s %s\n# TYPE %s summary\n", s.name, s.help, s.name)
		for _, q := range []float64{0.5, 0.9, 0.99} {
			if v, ok := s.win.Quantile(q); ok {
				p("%s{quantile=\"%g\"} %d\n", s.name, q, v)
			}
		}
		p("%s_count %d\n", s.name, s.win.Count())
	}
	b2i := func(b bool) int {
		if b {
			return 1
		}
		return 0
	}
	p("# TYPE antisismo_delivery_total counter\nantisismo_delivery_total{result=\"sent\"} %d\nantisismo_delivery_total{result=\"failed\"} %d\n", d.Sent.Load(), d.Failed.Load())
	p("# TYPE antisismo_delivery_retries_total counter\nantisismo_delivery_retries_total %d\n", d.Retries.Load())
	p("# TYPE antisismo_delivery_dlq_total counter\nantisismo_delivery_dlq_total %d\n", d.DLQ.Load())
	p("# TYPE antisismo_signature_failures_total counter\nantisismo_signature_failures_total %d\n", d.SignFailures.Load())
	p("# TYPE antisismo_queue_degraded gauge\nantisismo_queue_degraded %d\n", b2i(d.QueueDegraded.Load()))
	p("# TYPE antisismo_push_transport_ready gauge\nantisismo_push_transport_ready %d\n", b2i(d.TransportReady.Load()))
	return err
}
