package emsc

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"

	"antisismo.app/ingestion/resilience"
	"antisismo.app/ingestion/sources"
)

// Ejemplo oficial (EMSC-CSEM/webservices101, seismicportal_listener.py).
const official = `{"action":"create","data":{"type":"Feature","geometry":{"type":"Point","coordinates":[28.5381,40.115,-7.0]},"id":"20250305_0000090","properties":{"source_id":"1779128","source_catalog":"EMSC-RTS","lastupdate":"2025-03-05T10:06:56.102425Z","time":"2025-03-05T09:45:07.0Z","flynn_region":"WESTERN TURKEY","lat":40.115,"lon":28.5381,"depth":7.0,"evtype":"ke","auth":"AFAD","mag":1.4,"magtype":"ml","unid":"20250305_0000090"}}}`

func msg(action, unid, extra string) string {
	return `{"action":"` + action + `","data":{"properties":{"unid":"` + unid + `","time":"2026-09-28T20:32:07.0Z","lastupdate":"2026-09-28T20:33:00Z","lat":18.47,"lon":-69.9,"depth":10,"mag":5.1,"magtype":"mw","evtype":"ke","flynn_region":"DOMINICAN REPUBLIC"` + extra + `}}}`
}

func TestParseOfficialExample(t *testing.T) {
	o, err := ParseMessage([]byte(official), 1790627527000)
	if err != nil {
		t.Fatal(err)
	}
	e := o.Event
	if o.Source != "emsc" || o.SourceID != "20250305_0000090" || e.Lat != 40.115 || e.Lon != 28.5381 || e.DepthKm != 7 {
		t.Fatalf("bad mapping (GeoJSON depth is negative; properties.depth is positive km): %+v", o)
	}
	if e.Magnitude != 1.4 || e.MagType != "ml" || e.Place != "WESTERN TURKEY" || e.SolutionStatus != "automatic" {
		t.Fatalf("bad fields: %+v", e)
	}
	if e.TimeUTCms != 1741167907000 || o.SourceUpdatedMs != 1741169216102 {
		t.Fatalf("times: %d %d", e.TimeUTCms, o.SourceUpdatedMs)
	}
	if err := e.Validate(); err != nil {
		t.Fatal(err)
	}
}

func TestParseActionsAndRejections(t *testing.T) {
	for _, a := range []string{"create", "created", "update", "updated", "insert", "UPDATE"} {
		if _, err := ParseMessage([]byte(msg(a, "x1", "")), 1790627527000); err != nil {
			t.Errorf("action %s: %v", a, err)
		}
	}
	cases := map[string]struct {
		in   string
		want error
	}{
		"delete action":     {msg("delete", "x1", ""), ErrSkip},
		"explosion evtype":  {strings.Replace(msg("create", "x1", ""), `"evtype":"ke"`, `"evtype":"kx"`, 1), ErrSkip},
		"not json":          {"{nope", ErrMalformed},
		"bad unid":          {msg("create", "../../etc", ""), ErrMalformed},
		"missing mag":       {strings.Replace(msg("create", "x1", ""), `"mag":5.1,`, "", 1), ErrMalformed},
		"lat out of range":  {strings.Replace(msg("create", "x1", ""), `"lat":18.47`, `"lat":118.47`, 1), ErrMalformed},
		"depth out":         {strings.Replace(msg("create", "x1", ""), `"depth":10`, `"depth":5000`, 1), ErrMalformed},
		"bad time":          {strings.Replace(msg("create", "x1", ""), "2026-09-28T20:32:07.0Z", "ayer", 1), ErrMalformed},
		"oversized message": {msg("create", "x1", `,"pad":"`+strings.Repeat("a", maxMessageBytes)+`"`), ErrMalformed},
	}
	for name, c := range cases {
		if _, err := ParseMessage([]byte(c.in), 1790627527000); !errors.Is(err, c.want) {
			t.Errorf("%s: got %v want %v", name, err, c.want)
		}
	}
}

func TestParseSanitizesRegionAndMagType(t *testing.T) {
	in := strings.Replace(msg("create", "x2", ""), `"flynn_region":"DOMINICAN REPUBLIC"`, `"flynn_region":"<script>alert(1)</script>\u0007ZONA"`, 1)
	in = strings.Replace(in, `"magtype":"mw"`, `"magtype":"m w;drop"`, 1)
	o, err := ParseMessage([]byte(in), 1790627527000)
	if err != nil {
		t.Fatal(err)
	}
	if strings.ContainsAny(o.Event.Place, "<>\a") || o.Event.MagType != "unk" {
		t.Fatalf("not sanitized: %q %q", o.Event.Place, o.Event.MagType)
	}
}

// Servidor WebSocket real (httptest): cada conexión envía un mensaje distinto y corta. El cliente debe
// reconectar con backoff y entregar ambos (QA-20 reconexión forzada).
func TestClientReconnectsAfterServerDrops(t *testing.T) {
	var conns atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		n := conns.Add(1)
		_ = c.Write(r.Context(), websocket.MessageText, []byte(msg("create", "conn"+string(rune('0'+n)), "")))
		_ = c.Close(websocket.StatusGoingAway, "drop")
	}))
	defer srv.Close()

	var statusMu sync.Mutex
	var downs int
	c := &Client{
		URL: "ws" + strings.TrimPrefix(srv.URL, "http"),
		Dial: func(ctx context.Context, u string) (Conn, error) {
			ws, _, err := websocket.Dial(ctx, u, nil)
			if err != nil {
				return nil, err
			}
			return wsConn{ws}, nil
		},
		PingInterval: time.Hour,
		Backoff:      resilience.NewBackoff(time.Millisecond, 5*time.Millisecond),
		Now:          time.Now,
		OnStatus: func(err error) {
			if err != nil {
				statusMu.Lock()
				downs++
				statusMu.Unlock()
			}
		},
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	out := make(chan sources.Observation, 4)
	go func() { _ = c.Run(ctx, out) }()
	got := map[string]bool{}
	for len(got) < 2 {
		select {
		case o := <-out:
			got[o.SourceID] = true
		case <-ctx.Done():
			t.Fatalf("timeout; got %v connects=%d", got, c.Stats.Connects.Load())
		}
	}
	cancel()
	if !got["conn1"] || !got["conn2"] || c.Stats.Connects.Load() < 2 {
		t.Fatalf("expected reconnection, got %v connects=%d", got, c.Stats.Connects.Load())
	}
	statusMu.Lock()
	defer statusMu.Unlock()
	if downs < 1 {
		t.Fatal("disconnect must be reported to health")
	}
}

type fakeConn struct {
	pingErr error
	block   chan struct{}
	closed  atomic.Bool
}

func (f *fakeConn) Read(ctx context.Context) ([]byte, error) {
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-f.block:
		return nil, errors.New("closed")
	}
}
func (f *fakeConn) Ping(context.Context) error { return f.pingErr }
func (f *fakeConn) Close() error {
	f.closed.Store(true)
	return nil
}

func TestPingFailureForcesReconnect(t *testing.T) {
	var dials atomic.Int32
	c := &Client{
		URL: "wss://www.seismicportal.eu" + Path,
		Dial: func(ctx context.Context, u string) (Conn, error) {
			dials.Add(1)
			return &fakeConn{pingErr: errors.New("pong timeout"), block: make(chan struct{})}, nil
		},
		PingInterval: 5 * time.Millisecond,
		Backoff:      resilience.NewBackoff(time.Millisecond, 2*time.Millisecond),
		Now:          time.Now,
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	go func() { _ = c.Run(ctx, make(chan sources.Observation)) }()
	for dials.Load() < 3 {
		if ctx.Err() != nil {
			t.Fatalf("half-open connection not detected; dials=%d", dials.Load())
		}
		time.Sleep(2 * time.Millisecond)
	}
}

func TestDialFailureBacksOffAndStopsOnCancel(t *testing.T) {
	var dials atomic.Int32
	c := &Client{
		URL: "wss://www.seismicportal.eu" + Path,
		Dial: func(context.Context, string) (Conn, error) {
			dials.Add(1)
			return nil, errors.New("connection refused")
		},
		PingInterval: time.Second,
		Backoff:      resilience.NewBackoff(20*time.Millisecond, 40*time.Millisecond),
		Now:          time.Now,
	}
	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer cancel()
	err := c.Run(ctx, make(chan sources.Observation))
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Run must stop on cancel, got %v", err)
	}
	// Con backoff ≤ 40 ms en 150 ms nunca debe haber un bucle agresivo (cientos de intentos).
	if n := dials.Load(); n < 2 || n > 60 {
		t.Fatalf("unexpected dial count %d", n)
	}
}

func TestAllowlistDialerRejectsUnsafeTargets(t *testing.T) {
	dial := AllowlistDialer("www.seismicportal.eu")
	for _, u := range []string{
		"ws://www.seismicportal.eu" + Path,      // sin TLS
		"wss://evil.example.com" + Path,         // otro host
		"wss://www.seismicportal.eu.evil.com/x", // sufijo engañoso
		"wss://169.254.169.254/latest/meta-data",
		"::not a url",
	} {
		if _, err := dial(context.Background(), u); !errors.Is(err, resilience.ErrHostNotAllowed) {
			t.Errorf("%s: expected ErrHostNotAllowed, got %v", u, err)
		}
	}
}

func TestNewClientDefaults(t *testing.T) {
	c := NewClient("www.seismicportal.eu", 500*time.Millisecond, 30*time.Second)
	if c.URL != "wss://www.seismicportal.eu/standing_order/websocket" || c.PingInterval != 15*time.Second || c.Name() != "emsc" || !c.Enabled() {
		t.Fatalf("defaults: %+v", c)
	}
}
