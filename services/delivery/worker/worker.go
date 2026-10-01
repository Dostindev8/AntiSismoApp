// Package worker consume la cola y entrega a FCM/APNs: reintentos ×3 con backoff+jitter, DLQ y alarma
// operativa. Una alerta fallida nunca se descarta en silencio.
package worker

import (
	"context"
	"log/slog"
	"math/rand/v2"
	"sync"
	"time"

	"antisismo.app/delivery/metrics"
	"antisismo.app/delivery/queue"
	"antisismo.app/delivery/transport"
)

// DeadLetter guarda trabajos agotados (acotado) para reproceso manual o automático.
type DeadLetter struct {
	mu   sync.Mutex
	jobs []queue.Job
	max  int
}

func NewDeadLetter(max int) *DeadLetter { return &DeadLetter{max: max} }

func (d *DeadLetter) Put(j queue.Job) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if len(d.jobs) >= d.max {
		d.jobs = d.jobs[1:]
	}
	d.jobs = append(d.jobs, j)
}

func (d *DeadLetter) Len() int {
	d.mu.Lock()
	defer d.mu.Unlock()
	return len(d.jobs)
}

// Drain devuelve y vacía la DLQ (reencolar cuando el proveedor se recupere).
func (d *DeadLetter) Drain() []queue.Job {
	d.mu.Lock()
	defer d.mu.Unlock()
	out := d.jobs
	d.jobs = nil
	return out
}

type Worker struct {
	Queue       queue.Queue
	Transport   transport.Transport
	DLQ         *DeadLetter
	Metrics     *metrics.Delivery
	Log         *slog.Logger
	Now         func() time.Time
	MaxAttempts int
	SendTimeout time.Duration
	BackoffBase time.Duration
}

func (w *Worker) defaults() {
	if w.MaxAttempts <= 0 {
		w.MaxAttempts = 3
	}
	if w.SendTimeout <= 0 {
		w.SendTimeout = 2 * time.Second
	}
	if w.BackoffBase <= 0 {
		w.BackoffBase = 100 * time.Millisecond
	}
	if w.Now == nil {
		w.Now = time.Now
	}
	if w.Log == nil {
		w.Log = slog.Default()
	}
}

func (w *Worker) Run(ctx context.Context) error {
	w.defaults()
	for {
		j, err := w.Queue.Pop(ctx)
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			continue
		}
		if !w.Process(ctx, j) && ctx.Err() != nil {
			// Apagado a mitad de envío: sin ack, el trabajo queda pendiente en Redis y otra instancia
			// lo reclama (XAUTOCLAIM). Nunca se confirma como entregado algo que no salió.
			return ctx.Err()
		}
		_ = w.Queue.Ack(context.WithoutCancel(ctx), j)
	}
}

// Process entrega un trabajo con reintentos. Expone el resultado en métricas y logs estructurados
// (sin payload ni datos personales).
func (w *Worker) Process(ctx context.Context, j queue.Job) bool {
	w.defaults()
	msg := transport.Message{Topic: j.Topic, Level: j.Level, AlertID: j.AlertID, Payload: j.Payload, Title: j.Title, Body: j.Body}
	var err error
	for attempt := 1; attempt <= w.MaxAttempts; attempt++ {
		sctx, cancel := context.WithTimeout(ctx, w.SendTimeout)
		err = w.Transport.Send(sctx, msg)
		cancel()
		if err == nil {
			now := w.Now().UnixMilli()
			w.Metrics.Sent.Add(1)
			if j.ReceivedAtMs > 0 {
				w.Metrics.LatencyE2E.Observe(now - j.ReceivedAtMs)
			}
			if j.EnqueuedAtMs > 0 {
				w.Metrics.QueueToSend.Observe(now - j.EnqueuedAtMs)
			}
			return true
		}
		if transport.IsPermanent(err) || ctx.Err() != nil || attempt == w.MaxAttempts {
			break
		}
		w.Metrics.Retries.Add(1)
		ceil := w.BackoffBase << (attempt - 1)
		t := time.NewTimer(time.Duration(rand.Float64() * float64(ceil)))
		select {
		case <-ctx.Done():
			t.Stop()
		case <-t.C:
		}
	}
	if ctx.Err() != nil {
		w.Log.Warn("delivery interrupted by shutdown; left pending for reclaim", "event", "delivery_interrupted",
			"alert_id", j.AlertID, "topic", j.Topic, "level", j.Level)
		return false
	}
	w.Metrics.Failed.Add(1)
	w.Metrics.DLQ.Add(1)
	j.Attempts = w.MaxAttempts
	w.DLQ.Put(j)
	w.Log.Error("delivery failed; moved to DLQ", "event", "delivery_dlq", "alert_id", j.AlertID, "topic", j.Topic,
		"level", j.Level, "transport", w.Transport.Name(), "error", err.Error())
	return false
}
