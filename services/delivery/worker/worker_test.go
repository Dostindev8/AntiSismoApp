package worker

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"antisismo.app/delivery/metrics"
	"antisismo.app/delivery/queue"
	"antisismo.app/delivery/transport"
)

// scripted devuelve los errores en orden; nil = éxito.
type scripted struct {
	mu    sync.Mutex
	errs  []error
	calls int
}

func (s *scripted) Name() string { return "scripted" }
func (s *scripted) Send(context.Context, transport.Message) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls++
	if len(s.errs) == 0 {
		return nil
	}
	e := s.errs[0]
	s.errs = s.errs[1:]
	return e
}

func newWorker(tr transport.Transport, logBuf *bytes.Buffer) *Worker {
	return &Worker{
		Transport: tr, DLQ: NewDeadLetter(2), Metrics: metrics.NewDelivery(),
		Log: slog.New(slog.NewJSONHandler(logBuf, nil)), BackoffBase: time.Millisecond,
		Now: func() time.Time { return time.UnixMilli(5_000) },
	}
}

func j(id string) queue.Job {
	return queue.Job{ID: id, AlertID: "a1", Topic: "alerts_DO_d7q3", Level: "CRITICAL", Payload: []byte("p"), ReceivedAtMs: 4_000, EnqueuedAtMs: 4_500}
}

func TestSuccessRecordsLatency(t *testing.T) {
	var buf bytes.Buffer
	w := newWorker(&scripted{}, &buf)
	if !w.Process(context.Background(), j("1")) {
		t.Fatal("expected success")
	}
	p50, _ := w.Metrics.LatencyE2E.Quantile(0.5)
	q, _ := w.Metrics.QueueToSend.Quantile(0.5)
	if w.Metrics.Sent.Load() != 1 || p50 != 1_000 || q != 500 {
		t.Fatalf("sent=%d e2e=%d q=%d", w.Metrics.Sent.Load(), p50, q)
	}
}

func TestTransientFailureRetriesThenSucceeds(t *testing.T) {
	var buf bytes.Buffer
	tr := &scripted{errs: []error{errors.New("503"), errors.New("503")}}
	w := newWorker(tr, &buf)
	if !w.Process(context.Background(), j("1")) || tr.calls != 3 || w.Metrics.Retries.Load() != 2 || w.DLQ.Len() != 0 {
		t.Fatalf("calls=%d retries=%d dlq=%d", tr.calls, w.Metrics.Retries.Load(), w.DLQ.Len())
	}
}

func TestFCMDownGoesToDLQWithOpsAlarm(t *testing.T) {
	var buf bytes.Buffer
	tr := &scripted{errs: []error{errors.New("503"), errors.New("503"), errors.New("503"), errors.New("503")}}
	w := newWorker(tr, &buf)
	if w.Process(context.Background(), j("1")) {
		t.Fatal("expected failure")
	}
	if tr.calls != 3 || w.DLQ.Len() != 1 || w.Metrics.DLQ.Load() != 1 || w.Metrics.Failed.Load() != 1 {
		t.Fatalf("calls=%d dlq=%d", tr.calls, w.DLQ.Len())
	}
	logs := buf.String()
	if !strings.Contains(logs, `"event":"delivery_dlq"`) || !strings.Contains(logs, `"level":"ERROR"`) || strings.Contains(logs, `"p"`) {
		t.Fatalf("ops alarm log missing or leaks payload: %s", logs)
	}
	drained := w.DLQ.Drain()
	if len(drained) != 1 || drained[0].Attempts != 3 || w.DLQ.Len() != 0 {
		t.Fatalf("drain: %+v", drained)
	}
}

func TestPermanentAndUnconfiguredDoNotRetry(t *testing.T) {
	for _, e := range []error{fmt.Errorf("%w: 404", transport.ErrPermanent), transport.ErrNotConfigured} {
		var buf bytes.Buffer
		tr := &scripted{errs: []error{e}}
		w := newWorker(tr, &buf)
		if w.Process(context.Background(), j("1")) || tr.calls != 1 || w.DLQ.Len() != 1 {
			t.Fatalf("%v: calls=%d dlq=%d", e, tr.calls, w.DLQ.Len())
		}
	}
}

// blocking simula un proveedor lento: el envío solo termina por cancelación.
type blocking struct{ started chan struct{} }

func (b blocking) Name() string { return "blocking" }
func (b blocking) Send(ctx context.Context, _ transport.Message) error {
	close(b.started)
	<-ctx.Done()
	return ctx.Err()
}

type ackSpy struct {
	*queue.Memory
	acks atomic.Int64
}

func (a *ackSpy) Ack(context.Context, queue.Job) error { a.acks.Add(1); return nil }

func TestShutdownMidSendNeitherAcksNorDeadLetters(t *testing.T) {
	var buf bytes.Buffer
	q := &ackSpy{Memory: queue.NewMemory(4)}
	_ = q.Push(context.Background(), j("1"))
	tr := blocking{started: make(chan struct{})}
	w := newWorker(tr, &buf)
	w.Queue, w.SendTimeout = q, time.Minute
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- w.Run(ctx) }()
	<-tr.started
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("run: %v", err)
	}
	if q.acks.Load() != 0 || w.DLQ.Len() != 0 || w.Metrics.Failed.Load() != 0 {
		t.Fatalf("acks=%d dlq=%d failed=%d", q.acks.Load(), w.DLQ.Len(), w.Metrics.Failed.Load())
	}
	if !strings.Contains(buf.String(), `"event":"delivery_interrupted"`) {
		t.Fatal("interruption not logged")
	}
}

func TestDeadLetterIsBounded(t *testing.T) {
	d := NewDeadLetter(2)
	d.Put(j("1"))
	d.Put(j("2"))
	d.Put(j("3"))
	got := d.Drain()
	if len(got) != 2 || got[0].ID != "2" || got[1].ID != "3" {
		t.Fatalf("%+v", got)
	}
}

func TestRunConsumesQueueAndStopsOnCancel(t *testing.T) {
	var buf bytes.Buffer
	q := queue.NewMemory(10)
	ctx, cancel := context.WithCancel(context.Background())
	for i := range 5 {
		_ = q.Push(ctx, j(fmt.Sprint(i)))
	}
	w := newWorker(&scripted{}, &buf)
	w.Queue = q
	done := make(chan error, 1)
	go func() { done <- w.Run(ctx) }()
	deadline := time.After(2 * time.Second)
	for w.Metrics.Sent.Load() < 5 {
		select {
		case <-deadline:
			t.Fatalf("sent=%d", w.Metrics.Sent.Load())
		case <-time.After(5 * time.Millisecond):
		}
	}
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("run: %v", err)
	}
}
