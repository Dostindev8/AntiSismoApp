package metrics

import (
	"bytes"
	"strings"
	"testing"
)

func TestWindowQuantilesNearestRank(t *testing.T) {
	w := NewWindow(100)
	if _, ok := w.Quantile(0.5); ok {
		t.Fatal("empty window must report no data")
	}
	for i := int64(1); i <= 100; i++ {
		w.Observe(i)
	}
	for q, want := range map[float64]int64{0.5: 50, 0.99: 99, 1: 100, 0: 1} {
		if got, _ := w.Quantile(q); got != want {
			t.Errorf("q%.2f=%d want %d", q, got, want)
		}
	}
	// El anillo descarta las muestras más viejas.
	for range 100 {
		w.Observe(1_000)
	}
	if got, _ := w.Quantile(0.5); got != 1_000 || w.Count() != 100 {
		t.Fatalf("ring: p50=%d count=%d", got, w.Count())
	}
}

func TestPrometheusExposition(t *testing.T) {
	d := NewDelivery()
	d.LatencyE2E.Observe(800)
	d.Sent.Add(3)
	d.DLQ.Add(1)
	d.QueueDegraded.Store(true)
	var b bytes.Buffer
	if err := d.WritePrometheus(&b); err != nil {
		t.Fatal(err)
	}
	out := b.String()
	for _, want := range []string{
		`antisismo_latency_e2e_ms{quantile="0.99"} 800`, "antisismo_latency_e2e_ms_count 1",
		"antisismo_queue_to_send_ms_count 0", `antisismo_delivery_total{result="sent"} 3`,
		"antisismo_delivery_dlq_total 1", "antisismo_queue_degraded 1", "antisismo_push_transport_ready 0",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q", want)
		}
	}
}
