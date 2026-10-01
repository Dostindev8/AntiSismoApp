// Package queue: cola prioritaria del camino crítico. Redis Streams en producción; si Redis falla, la
// cola en memoria toma el relevo sin perder trabajos (degradación NIVEL 1, ver docs/adr/0003).
package queue

import (
	"context"
	"errors"
	"sync"
)

type Priority int

const (
	Critical Priority = iota
	Informative
	Drill
	numPriorities
)

// Job = un push a un topic. ID = alert_id + ":" + topic (idempotente: el mismo par nunca se encola dos veces).
type Job struct {
	ID           string
	AlertID      string
	Topic        string
	Level        string
	Priority     Priority
	Payload      []byte
	Title, Body  string
	ReceivedAtMs int64 // evento recibido por ingesta (inicio del presupuesto e2e)
	EnqueuedAtMs int64
	Attempts     int
	origin       string // "mem" | "redis"
	redisID      string
}

var (
	ErrFull   = errors.New("queue: full")
	ErrClosed = errors.New("queue: closed")
)

type Queue interface {
	Push(ctx context.Context, j Job) error
	Pop(ctx context.Context) (Job, error)
	Ack(ctx context.Context, j Job) error
	Len() int
}

// Memory: FIFO por prioridad. Capacidad acotada para INFORMATIVE/DRILL (se descartan los más viejos
// de menor prioridad); CRITICAL nunca se descarta mientras haya memoria razonable (hardCap).
type Memory struct {
	mu      sync.Mutex
	q       [numPriorities][]Job
	pending map[string]bool
	cap     int
	hardCap int
	notify  chan struct{}
	dropped int64
}

func NewMemory(capacity int) *Memory {
	return &Memory{pending: map[string]bool{}, cap: capacity, hardCap: capacity * 8, notify: make(chan struct{}, 1)}
}

func (m *Memory) size() int { return len(m.q[0]) + len(m.q[1]) + len(m.q[2]) }

func (m *Memory) Push(_ context.Context, j Job) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if j.Priority < 0 || j.Priority >= numPriorities {
		return errors.New("queue: invalid priority")
	}
	if m.pending[j.ID] {
		return nil
	}
	if m.size() >= m.cap {
		if j.Priority != Critical && !m.dropLowest(j.Priority) {
			m.dropped++
			return ErrFull
		}
		if j.Priority == Critical && m.size() >= m.hardCap && !m.dropLowest(Critical) {
			return ErrFull
		}
	}
	j.origin = "mem"
	m.q[j.Priority] = append(m.q[j.Priority], j)
	m.pending[j.ID] = true
	select {
	case m.notify <- struct{}{}:
	default:
	}
	return nil
}

// dropLowest elimina el trabajo más viejo de prioridad estrictamente menor que p.
func (m *Memory) dropLowest(p Priority) bool {
	for lvl := numPriorities - 1; lvl > p; lvl-- {
		if len(m.q[lvl]) > 0 {
			delete(m.pending, m.q[lvl][0].ID)
			m.q[lvl] = m.q[lvl][1:]
			m.dropped++
			return true
		}
	}
	return false
}

// TryPop devuelve el siguiente trabajo sin bloquear (CRITICAL primero).
func (m *Memory) TryPop() (Job, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for p := range m.q {
		if len(m.q[p]) > 0 {
			j := m.q[p][0]
			m.q[p][0] = Job{}
			m.q[p] = m.q[p][1:]
			delete(m.pending, j.ID)
			return j, true
		}
	}
	return Job{}, false
}

func (m *Memory) Pop(ctx context.Context) (Job, error) {
	for {
		if j, ok := m.TryPop(); ok {
			if m.Len() > 0 {
				select {
				case m.notify <- struct{}{}:
				default:
				}
			}
			return j, nil
		}
		select {
		case <-ctx.Done():
			return Job{}, ctx.Err()
		case <-m.notify:
		}
	}
}

func (m *Memory) Ack(context.Context, Job) error { return nil }

func (m *Memory) Len() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.size()
}

func (m *Memory) Dropped() int64 {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.dropped
}
