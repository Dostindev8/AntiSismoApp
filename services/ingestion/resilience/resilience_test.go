package resilience

import (
	"errors"
	"net/http"
	"testing"
	"time"
)

func TestAllowlistBlocksSSRF(t *testing.T) {
	c := NewHTTPClient([]string{"earthquake.usgs.gov"}, 2*time.Second)
	for _, u := range []string{
		"https://169.254.169.254/latest/meta-data/",
		"http://earthquake.usgs.gov/", // sin TLS
		"https://evil.example.com/",
		"https://earthquake.usgs.gov.evil.com/",
	} {
		req, _ := http.NewRequest(http.MethodGet, u, nil)
		if _, err := c.Do(req); !errors.Is(err, ErrHostNotAllowed) {
			t.Errorf("%s: expected allowlist rejection, got %v", u, err)
		}
	}
}

func TestBackoffFullJitterBounded(t *testing.T) {
	b := NewBackoff(500*time.Millisecond, 30*time.Second)
	b.rnd = func() float64 { return 0.999999 }
	var last time.Duration
	for i := 0; i < 100; i++ {
		d := b.Next()
		if d > 30*time.Second || d < 0 {
			t.Fatalf("attempt %d out of bounds: %s", i, d)
		}
		last = d
	}
	if last < 29*time.Second {
		t.Fatalf("backoff never reached max: %s", last)
	}
	b.Reset()
	if d := b.Next(); d > 500*time.Millisecond {
		t.Fatalf("reset failed: %s", d)
	}
	b.rnd = func() float64 { return 0 }
	if b.Next() != 0 {
		t.Fatal("jitter lower bound must be 0")
	}
}

func TestBreakerLifecycle(t *testing.T) {
	now := time.Unix(0, 0)
	b := NewBreaker(3, 10*time.Second)
	b.now = func() time.Time { return now }
	boom := errors.New("boom")
	for i := 0; i < 3; i++ {
		if err := b.Allow(); err != nil {
			t.Fatalf("closed breaker rejected call %d", i)
		}
		b.Record(boom)
	}
	if b.State() != Open || b.Allow() != ErrOpen {
		t.Fatal("breaker should be open after 3 failures")
	}
	now = now.Add(10 * time.Second)
	if err := b.Allow(); err != nil || b.State() != HalfOpen {
		t.Fatal("breaker should allow one probe after cooldown")
	}
	if b.Allow() != ErrOpen {
		t.Fatal("only one concurrent probe in half-open")
	}
	b.Record(boom)
	if b.State() != Open {
		t.Fatal("failed probe must reopen")
	}
	now = now.Add(10 * time.Second)
	_ = b.Allow()
	b.Record(nil)
	if b.State() != Closed || b.Allow() != nil {
		t.Fatal("successful probe must close")
	}
}
