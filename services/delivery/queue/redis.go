package queue

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"sync/atomic"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	streamPrefix = "antisismo:delivery:p"
	dedupPrefix  = "antisismo:delivery:dedup:"
	group        = "delivery"
	maxLen       = 100_000
)

// Redis: un stream por prioridad + grupo de consumidores (entrega al menos una vez; el dispositivo
// deduplica por alert_id). Dedup de encolado con SET NX (ventana 10 min).
type Redis struct {
	c         *redis.Client
	consumer  string
	block     time.Duration
	claimIdle time.Duration
}

func NewRedis(ctx context.Context, c *redis.Client, consumer string) (*Redis, error) {
	r := &Redis{c: c, consumer: consumer, block: 250 * time.Millisecond, claimIdle: ClaimIdle}
	for p := Priority(0); p < numPriorities; p++ {
		err := c.XGroupCreateMkStream(ctx, stream(p), group, "$").Err()
		if err != nil && !isBusyGroup(err) {
			return nil, fmt.Errorf("queue: create group: %w", err)
		}
	}
	return r, nil
}

func isBusyGroup(err error) bool {
	return err != nil && len(err.Error()) >= 9 && err.Error()[:9] == "BUSYGROUP"
}

func stream(p Priority) string { return streamPrefix + strconv.Itoa(int(p)) }

func (r *Redis) Push(ctx context.Context, j Job) error {
	ok, err := r.c.SetNX(ctx, dedupPrefix+j.ID, 1, 10*time.Minute).Result()
	if err != nil {
		return err
	}
	if !ok {
		return nil // ya encolado (idempotencia)
	}
	return r.c.XAdd(ctx, &redis.XAddArgs{
		Stream: stream(j.Priority), MaxLen: maxLen, Approx: true,
		Values: map[string]any{
			"id": j.ID, "alert_id": j.AlertID, "topic": j.Topic, "level": j.Level, "payload": j.Payload,
			"title": j.Title, "body": j.Body, "recv": j.ReceivedAtMs, "enq": j.EnqueuedAtMs,
		},
	}).Err()
}

func (r *Redis) read(ctx context.Context, streams []string, block time.Duration) (Job, bool, error) {
	res, err := r.c.XReadGroup(ctx, &redis.XReadGroupArgs{Group: group, Consumer: r.consumer, Streams: streams, Count: 1, Block: block}).Result()
	if errors.Is(err, redis.Nil) {
		return Job{}, false, nil
	}
	if err != nil {
		return Job{}, false, err
	}
	for _, s := range res {
		for _, m := range s.Messages {
			p, _ := strconv.Atoi(s.Stream[len(streamPrefix):])
			return decode(m, Priority(p)), true, nil
		}
	}
	return Job{}, false, nil
}

// ClaimIdle: un trabajo entregado y sin ack durante este tiempo (consumidor caído) se reclama.
const ClaimIdle = 30 * time.Second

// Pop sondea CRITICAL → INFORMATIVE → DRILL sin bloquear, reclama trabajos huérfanos y luego bloquea
// brevemente solo en CRITICAL (latencia mínima para lo urgente).
func (r *Redis) Pop(ctx context.Context) (Job, error) {
	for {
		for p := Priority(0); p < numPriorities; p++ {
			j, ok, err := r.read(ctx, []string{stream(p), ">"}, -1)
			if err != nil {
				return Job{}, err
			}
			if ok {
				return j, nil
			}
		}
		for p := Priority(0); p < numPriorities; p++ {
			msgs, _, err := r.c.XAutoClaim(ctx, &redis.XAutoClaimArgs{Stream: stream(p), Group: group, Consumer: r.consumer, MinIdle: r.claimIdle, Start: "0-0", Count: 1}).Result()
			if err != nil {
				return Job{}, err
			}
			if len(msgs) > 0 {
				return decode(msgs[0], p), nil
			}
		}
		j, ok, err := r.read(ctx, []string{stream(Critical), ">"}, r.block)
		if err != nil {
			return Job{}, err
		}
		if ok {
			return j, nil
		}
	}
}

func (r *Redis) Ack(ctx context.Context, j Job) error {
	if j.redisID == "" {
		return nil
	}
	return r.c.XAck(ctx, stream(j.Priority), group, j.redisID).Err()
}

func (r *Redis) Len() int {
	n := 0
	for p := Priority(0); p < numPriorities; p++ {
		if v, err := r.c.XLen(context.Background(), stream(p)).Result(); err == nil {
			n += int(v)
		}
	}
	return n
}

func decode(m redis.XMessage, p Priority) Job {
	s := func(k string) string {
		v, _ := m.Values[k].(string)
		return v
	}
	i := func(k string) int64 {
		v, _ := strconv.ParseInt(s(k), 10, 64)
		return v
	}
	return Job{
		ID: s("id"), AlertID: s("alert_id"), Topic: s("topic"), Level: s("level"), Priority: p,
		Payload: []byte(s("payload")), Title: s("title"), Body: s("body"),
		ReceivedAtMs: i("recv"), EnqueuedAtMs: i("enq"), origin: "redis", redisID: m.ID,
	}
}

// Fallback: Redis primero; ante cualquier error de Redis el trabajo va a memoria (nunca se pierde una
// alerta por una caída de Redis) y Degraded() lo reporta a métricas. Circuit breaker: tras un error,
// Redis no se vuelve a intentar durante Cooldown, para que ni Push ni Pop paguen timeouts de conexión
// mientras hay alertas esperando en memoria.
type Fallback struct {
	Primary   Queue
	Memory    *Memory
	Timeout   time.Duration
	Cooldown  time.Duration
	degraded  atomic.Bool
	fallback  atomic.Int64
	openUntil atomic.Int64 // unix nano; Redis no se usa antes de este instante
}

func NewFallback(primary Queue, mem *Memory) *Fallback {
	return &Fallback{Primary: primary, Memory: mem, Timeout: 150 * time.Millisecond, Cooldown: 2 * time.Second}
}

func (f *Fallback) Degraded() bool        { return f.degraded.Load() }
func (f *Fallback) FallbackPushes() int64 { return f.fallback.Load() }

func (f *Fallback) trip() {
	f.degraded.Store(true)
	f.openUntil.Store(time.Now().Add(f.Cooldown).UnixNano())
}

// openFor devuelve cuánto falta para volver a probar Redis (0 = cerrado / semiabierto).
func (f *Fallback) openFor() time.Duration {
	return time.Duration(f.openUntil.Load() - time.Now().UnixNano())
}

func (f *Fallback) Push(ctx context.Context, j Job) error {
	if f.Primary != nil {
		if f.openFor() > 0 {
			f.fallback.Add(1)
			return f.Memory.Push(ctx, j)
		}
		pctx, cancel := context.WithTimeout(ctx, f.Timeout)
		err := f.Primary.Push(pctx, j)
		cancel()
		if err == nil {
			f.degraded.Store(false)
			return nil
		}
		f.trip()
		f.fallback.Add(1)
	}
	return f.Memory.Push(ctx, j)
}

func (f *Fallback) Pop(ctx context.Context) (Job, error) {
	for {
		if j, ok := f.Memory.TryPop(); ok {
			return j, nil
		}
		if f.Primary == nil {
			return f.Memory.Pop(ctx)
		}
		if wait := f.openFor(); wait > 0 {
			wctx, wcancel := context.WithTimeout(ctx, wait)
			j, err := f.Memory.Pop(wctx)
			wcancel()
			if err == nil {
				return j, nil
			}
			if ctx.Err() != nil {
				return Job{}, ctx.Err()
			}
			continue
		}
		pctx, cancel := context.WithTimeout(ctx, 300*time.Millisecond)
		j, err := f.Primary.Pop(pctx)
		cancel()
		if err == nil {
			f.degraded.Store(false)
			return j, nil
		}
		if ctx.Err() != nil {
			return Job{}, ctx.Err()
		}
		if !errors.Is(err, context.DeadlineExceeded) {
			f.trip()
		}
	}
}

func (f *Fallback) Ack(ctx context.Context, j Job) error {
	if j.origin == "redis" && f.Primary != nil {
		return f.Primary.Ack(ctx, j)
	}
	return nil
}

func (f *Fallback) Len() int {
	n := f.Memory.Len()
	if f.Primary != nil {
		n += f.Primary.Len()
	}
	return n
}
