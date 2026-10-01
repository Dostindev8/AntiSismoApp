// Package resilience: allowlist anti-SSRF, backoff con jitter y circuit breaker por fuente (§0.3 regla 7).
package resilience

import (
	"context"
	"errors"
	"fmt"
	"math/rand/v2"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

var ErrHostNotAllowed = errors.New("host not in allowlist")

// AllowlistTransport rechaza cualquier petición cuyo host no esté en la lista fija, incluidas redirecciones.
type AllowlistTransport struct {
	Allowed map[string]bool
	Next    http.RoundTripper
}

func (t *AllowlistTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	host := strings.ToLower(r.URL.Hostname())
	if r.URL.Scheme != "https" || !t.Allowed[host] {
		return nil, fmt.Errorf("%w: %s://%s", ErrHostNotAllowed, r.URL.Scheme, host)
	}
	return t.Next.RoundTrip(r)
}

// NewHTTPClient: TLS ≥ 1.2 (Go negocia 1.3 cuando el servidor lo soporta), timeouts estrictos, allowlist.
func NewHTTPClient(allowedHosts []string, timeout time.Duration) *http.Client {
	allowed := make(map[string]bool, len(allowedHosts))
	for _, h := range allowedHosts {
		allowed[strings.ToLower(h)] = true
	}
	base := http.DefaultTransport.(*http.Transport).Clone()
	base.DialContext = (&net.Dialer{Timeout: 3 * time.Second, KeepAlive: 30 * time.Second}).DialContext
	base.TLSHandshakeTimeout = 3 * time.Second
	base.ResponseHeaderTimeout = timeout
	base.MaxIdleConnsPerHost = 4
	return &http.Client{
		Timeout:   timeout,
		Transport: &AllowlistTransport{Allowed: allowed, Next: base},
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 3 {
				return errors.New("too many redirects")
			}
			return nil
		},
	}
}

// Backoff exponencial con "full jitter" (evita tormentas de reconexión sincronizadas — QA-20).
type Backoff struct {
	Base, Max time.Duration
	attempt   int
	rnd       func() float64
}

func NewBackoff(base, maxD time.Duration) *Backoff {
	return &Backoff{Base: base, Max: maxD, rnd: rand.Float64}
}

func (b *Backoff) Next() time.Duration {
	ceil := b.Base << min(b.attempt, 30)
	if ceil <= 0 || ceil > b.Max {
		ceil = b.Max
	}
	b.attempt++
	return time.Duration(b.rnd() * float64(ceil))
}

func (b *Backoff) Reset() { b.attempt = 0 }

// Sleep espera d o hasta que el contexto se cancele.
func Sleep(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

// Breaker: closed → open tras N fallos consecutivos → half-open tras cooldown (1 sonda) → closed si éxito.
type BreakerState int

const (
	Closed BreakerState = iota
	Open
	HalfOpen
)

var ErrOpen = errors.New("circuit open")

type Breaker struct {
	mu        sync.Mutex
	threshold int
	cooldown  time.Duration
	now       func() time.Time
	failures  int
	state     BreakerState
	openedAt  time.Time
	probing   bool
}

func NewBreaker(threshold int, cooldown time.Duration) *Breaker {
	return &Breaker{threshold: threshold, cooldown: cooldown, now: time.Now}
}

func (b *Breaker) State() BreakerState {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.state
}

// Allow indica si se puede intentar una llamada. En half-open solo se permite una sonda simultánea.
func (b *Breaker) Allow() error {
	b.mu.Lock()
	defer b.mu.Unlock()
	switch b.state {
	case Open:
		if b.now().Sub(b.openedAt) < b.cooldown {
			return ErrOpen
		}
		b.state, b.probing = HalfOpen, true
		return nil
	case HalfOpen:
		if b.probing {
			return ErrOpen
		}
		b.probing = true
	}
	return nil
}

func (b *Breaker) Record(err error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.probing = false
	if err == nil {
		b.failures, b.state = 0, Closed
		return
	}
	b.failures++
	if b.state == HalfOpen || b.failures >= b.threshold {
		b.state, b.openedAt = Open, b.now()
	}
}
