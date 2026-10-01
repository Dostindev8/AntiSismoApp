package queue

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func job(id string, p Priority) Job {
	return Job{ID: id, AlertID: "a-" + id, Topic: "alerts_DO_d7q3", Level: "CRITICAL", Priority: p, Payload: []byte(`{"v":1}`), ReceivedAtMs: 1, EnqueuedAtMs: 2}
}

func TestMemoryPriorityOrderAndDedup(t *testing.T) {
	m := NewMemory(10)
	ctx := context.Background()
	for _, j := range []Job{job("d", Drill), job("i", Informative), job("c1", Critical), job("c1", Critical), job("c2", Critical)} {
		if err := m.Push(ctx, j); err != nil {
			t.Fatal(err)
		}
	}
	if m.Len() != 4 {
		t.Fatalf("dedup failed: len=%d", m.Len())
	}
	var got []string
	for range 4 {
		j, err := m.Pop(ctx)
		if err != nil {
			t.Fatal(err)
		}
		got = append(got, j.ID)
	}
	want := []string{"c1", "c2", "i", "d"}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("order %v, want %v", got, want)
		}
	}
	// Tras salir de la cola, el mismo ID puede volver a encolarse (reintento posterior legítimo).
	if err := m.Push(ctx, job("c1", Critical)); err != nil || m.Len() != 1 {
		t.Fatalf("re-push after pop: err=%v len=%d", err, m.Len())
	}
}

func TestMemorySaturatedNeverDropsCritical(t *testing.T) {
	m := NewMemory(3)
	ctx := context.Background()
	_ = m.Push(ctx, job("d1", Drill))
	_ = m.Push(ctx, job("i1", Informative))
	_ = m.Push(ctx, job("i2", Informative))
	// Cola llena: un INFORMATIVE desplaza al DRILL más viejo.
	if err := m.Push(ctx, job("i3", Informative)); err != nil {
		t.Fatal(err)
	}
	// Llena solo con INFORMATIVE: otro INFORMATIVE no puede desplazar a su propio nivel.
	if err := m.Push(ctx, job("i4", Informative)); !errors.Is(err, ErrFull) {
		t.Fatalf("want ErrFull, got %v", err)
	}
	// CRITICAL siempre entra (hasta hardCap = 8×cap).
	for i := range 21 {
		if err := m.Push(ctx, job("c"+string(rune('a'+i)), Critical)); err != nil {
			t.Fatalf("critical %d rejected: %v", i, err)
		}
	}
	// En hardCap, CRITICAL desplaza a INFORMATIVE antes de rechazarse.
	if err := m.Push(ctx, job("cz", Critical)); err != nil {
		t.Fatalf("critical at hardCap should evict informative: %v", err)
	}
	if m.Dropped() < 2 {
		t.Fatalf("dropped=%d", m.Dropped())
	}
	j, _ := m.TryPop()
	if j.Priority != Critical {
		t.Fatalf("first pop not critical: %+v", j)
	}
}

func TestMemoryPopBlocksUntilPushOrCancel(t *testing.T) {
	m := NewMemory(4)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	if _, err := m.Pop(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("want deadline, got %v", err)
	}
	go func() {
		time.Sleep(10 * time.Millisecond)
		_ = m.Push(context.Background(), job("x", Critical))
	}()
	j, err := m.Pop(context.Background())
	if err != nil || j.ID != "x" {
		t.Fatalf("pop: %v %+v", err, j)
	}
	if err := m.Push(context.Background(), Job{ID: "bad", Priority: 7}); err == nil {
		t.Fatal("invalid priority accepted")
	}
}

func newRedis(t *testing.T) (*miniredis.Miniredis, *Redis) {
	t.Helper()
	mr := miniredis.RunT(t)
	c := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = c.Close() })
	r, err := NewRedis(context.Background(), c, "w1")
	if err != nil {
		t.Fatal(err)
	}
	return mr, r
}

func TestRedisRoundTripPriorityDedupAck(t *testing.T) {
	mr, r := newRedis(t)
	ctx := context.Background()
	// Segunda creación del grupo: BUSYGROUP tolerado (reinicio del servicio).
	if _, err := NewRedis(ctx, redis.NewClient(&redis.Options{Addr: mr.Addr()}), "w2"); err != nil {
		t.Fatal(err)
	}
	for _, j := range []Job{job("i", Informative), job("c", Critical), job("c", Critical)} {
		if err := r.Push(ctx, j); err != nil {
			t.Fatal(err)
		}
	}
	if r.Len() != 2 {
		t.Fatalf("len=%d (dedup SETNX)", r.Len())
	}
	j, err := r.Pop(ctx)
	if err != nil || j.ID != "c" || j.Priority != Critical || string(j.Payload) != `{"v":1}` || j.ReceivedAtMs != 1 || j.EnqueuedAtMs != 2 {
		t.Fatalf("pop critical: %v %+v", err, j)
	}
	if err := r.Ack(ctx, j); err != nil {
		t.Fatal(err)
	}
	j2, err := r.Pop(ctx)
	if err != nil || j2.ID != "i" {
		t.Fatalf("pop informative: %v %+v", err, j2)
	}
	if err := r.Ack(ctx, Job{}); err != nil {
		t.Fatal("ack without redis id must be a no-op")
	}
}

func TestRedisReclaimsOrphanedJob(t *testing.T) {
	mr, r := newRedis(t)
	ctx := context.Background()
	_ = r.Push(ctx, job("orphan", Critical))
	if _, err := r.Pop(ctx); err != nil { // entregado a w1, que "muere" sin ack
		t.Fatal(err)
	}
	other, err := NewRedis(ctx, redis.NewClient(&redis.Options{Addr: mr.Addr()}), "w2")
	if err != nil {
		t.Fatal(err)
	}
	other.block, other.claimIdle = 10*time.Millisecond, 20*time.Millisecond
	time.Sleep(40 * time.Millisecond)
	pctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	j, err := other.Pop(pctx)
	if err != nil || j.ID != "orphan" {
		t.Fatalf("orphan not reclaimed: %v %+v", err, j)
	}
}

func TestFallbackRedisDownNeverLosesAlert(t *testing.T) {
	mr, r := newRedis(t)
	r.block = 10 * time.Millisecond
	mem := NewMemory(10)
	f := NewFallback(r, mem)
	ctx := context.Background()

	if err := f.Push(ctx, job("viaRedis", Critical)); err != nil || f.Degraded() {
		t.Fatalf("healthy push: %v degraded=%v", err, f.Degraded())
	}
	j, err := f.Pop(ctx)
	if err != nil || j.ID != "viaRedis" || j.origin != "redis" {
		t.Fatalf("pop via redis: %v %+v", err, j)
	}
	if err := f.Ack(ctx, j); err != nil {
		t.Fatal(err)
	}

	mr.Close() // Redis cae
	if err := f.Push(ctx, job("viaMem", Critical)); err != nil {
		t.Fatalf("push with redis down: %v", err)
	}
	if !f.Degraded() || f.FallbackPushes() != 1 {
		t.Fatalf("degraded=%v fallback=%d", f.Degraded(), f.FallbackPushes())
	}
	pctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	start := time.Now()
	j, err = f.Pop(pctx)
	if err != nil || j.ID != "viaMem" {
		t.Fatalf("pop with redis down: %v %+v", err, j)
	}
	// Breaker abierto: una alerta que llega mientras Pop espera sale sin pagar timeouts de Redis.
	go func() {
		time.Sleep(20 * time.Millisecond)
		_ = f.Push(ctx, job("late", Critical))
	}()
	late, err := f.Pop(pctx)
	if err != nil || late.ID != "late" {
		t.Fatalf("late pop: %v %+v", err, late)
	}
	if el := time.Since(start); el > 150*time.Millisecond {
		t.Fatalf("degraded path too slow: %v", el)
	}
	if err := f.Ack(ctx, j); err != nil {
		t.Fatal("memory ack must not touch redis")
	}
	if f.Len() != 0 {
		t.Fatalf("len=%d", f.Len())
	}
	// Con Redis caído y la cola vacía, Pop respeta la cancelación.
	cctx, ccancel := context.WithTimeout(ctx, 100*time.Millisecond)
	defer ccancel()
	if _, err := f.Pop(cctx); err == nil {
		t.Fatal("expected cancellation")
	}
}

func TestFallbackMemoryOnly(t *testing.T) {
	f := NewFallback(nil, NewMemory(4))
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_ = f.Push(ctx, job("m", Informative))
	j, err := f.Pop(ctx)
	if err != nil || j.ID != "m" || f.Degraded() {
		t.Fatalf("%v %+v", err, j)
	}
}
