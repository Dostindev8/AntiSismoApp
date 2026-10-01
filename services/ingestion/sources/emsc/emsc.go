// Package emsc: cliente persistente del WebSocket de notificaciones casi en tiempo real de EMSC/CSEM
// (wss://www.seismicportal.eu/standing_order/websocket, datos CC BY 4.0). Fuente de respaldo de USGS.
// Formato verificado contra el ejemplo oficial EMSC-CSEM/webservices101 (seismicportal_listener.py).
package emsc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"

	"antisismo.app/ingestion/normalize"
	"antisismo.app/ingestion/resilience"
	"antisismo.app/ingestion/sources"
	"antisismo.app/proto/contract"
)

const (
	Path            = "/standing_order/websocket"
	maxMessageBytes = 64 << 10
	SourceName      = "emsc"
)

var (
	ErrSkip      = errors.New("emsc: message skipped")
	ErrMalformed = errors.New("emsc: malformed message")
	reUnid       = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)
	reMagType    = regexp.MustCompile(`^[A-Za-z_]{1,8}$`)
	// El servicio documenta create/update; versiones previas y clientes de terceros usan created/updated/insert.
	acceptedActions = map[string]bool{"create": true, "created": true, "insert": true, "update": true, "updated": true}
)

type message struct {
	Action string `json:"action"`
	Data   struct {
		Properties struct {
			Unid        string   `json:"unid"`
			Time        string   `json:"time"`
			LastUpdate  string   `json:"lastupdate"`
			Lat         *float64 `json:"lat"`
			Lon         *float64 `json:"lon"`
			Depth       *float64 `json:"depth"`
			Mag         *float64 `json:"mag"`
			MagType     string   `json:"magtype"`
			EvType      string   `json:"evtype"`
			FlynnRegion string   `json:"flynn_region"`
		} `json:"properties"`
	} `json:"data"`
}

// ParseMessage convierte un mensaje en observación. ErrSkip = mensaje válido sin interés (acción u
// tipo de evento distinto de sismo conocido); ErrMalformed = dato no confiable rechazado.
func ParseMessage(b []byte, receivedAtMs int64) (sources.Observation, error) {
	if len(b) > maxMessageBytes {
		return sources.Observation{}, fmt.Errorf("%w: too large", ErrMalformed)
	}
	var m message
	if err := json.Unmarshal(b, &m); err != nil {
		return sources.Observation{}, fmt.Errorf("%w: %v", ErrMalformed, err)
	}
	if !acceptedActions[strings.ToLower(m.Action)] {
		return sources.Observation{}, fmt.Errorf("%w: action %q", ErrSkip, m.Action)
	}
	p := m.Data.Properties
	// evtype "ke" = known earthquake. Ausente se acepta (mensajes antiguos); cualquier otro tipo se ignora.
	if p.EvType != "" && p.EvType != "ke" {
		return sources.Observation{}, fmt.Errorf("%w: evtype %q", ErrSkip, p.EvType)
	}
	if !reUnid.MatchString(p.Unid) || p.Lat == nil || p.Lon == nil || p.Depth == nil || p.Mag == nil {
		return sources.Observation{}, fmt.Errorf("%w: missing fields", ErrMalformed)
	}
	t, err := time.Parse(time.RFC3339Nano, p.Time)
	if err != nil {
		return sources.Observation{}, fmt.Errorf("%w: time", ErrMalformed)
	}
	updated := t
	if p.LastUpdate != "" {
		if u, err := time.Parse(time.RFC3339Nano, p.LastUpdate); err == nil {
			updated = u
		}
	}
	magType := "unk"
	if reMagType.MatchString(p.MagType) {
		magType = p.MagType
	}
	ev := contract.Event{
		ID:             normalize.EventID(SourceName, p.Unid),
		SourceIDs:      map[string]string{SourceName: p.Unid},
		Type:           "EARTHQUAKE",
		Magnitude:      *p.Mag,
		MagType:        magType,
		TimeUTCms:      t.UnixMilli(),
		ReceivedAtMs:   receivedAtMs,
		Lon:            *p.Lon,
		Lat:            *p.Lat,
		DepthKm:        *p.Depth,
		Place:          normalize.SanitizePlace(p.FlynnRegion),
		SolutionStatus: "automatic",
	}
	if err := ev.Validate(); err != nil {
		return sources.Observation{}, fmt.Errorf("%w: %v", ErrMalformed, err)
	}
	return sources.Observation{Source: SourceName, SourceID: p.Unid, SourceUpdatedMs: updated.UnixMilli(), Event: ev}, nil
}

// Conn abstrae la conexión (permite pruebas de reconexión deterministas).
type Conn interface {
	Read(ctx context.Context) ([]byte, error)
	Ping(ctx context.Context) error
	Close() error
}

type Dialer func(ctx context.Context, rawURL string) (Conn, error)

type wsConn struct{ c *websocket.Conn }

func (w wsConn) Read(ctx context.Context) ([]byte, error) {
	_, b, err := w.c.Read(ctx)
	return b, err
}
func (w wsConn) Ping(ctx context.Context) error { return w.c.Ping(ctx) }
func (w wsConn) Close() error                   { return w.c.Close(websocket.StatusNormalClosure, "bye") }

// AllowlistDialer solo permite wss:// hacia el host configurado (anti-SSRF, también en redirecciones).
func AllowlistDialer(host string) Dialer {
	allowed := strings.ToLower(host)
	client := &http.Client{ // Timeout=0: la conexión es de larga vida; los plazos se controlan por contexto.
		Transport: &resilience.AllowlistTransport{Allowed: map[string]bool{allowed: true}, Next: http.DefaultTransport},
	}
	return func(ctx context.Context, rawURL string) (Conn, error) {
		u, err := url.Parse(rawURL)
		if err != nil || u.Scheme != "wss" || strings.ToLower(u.Hostname()) != allowed {
			return nil, fmt.Errorf("%w: %s", resilience.ErrHostNotAllowed, rawURL)
		}
		dctx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		c, resp, err := websocket.Dial(dctx, rawURL, &websocket.DialOptions{HTTPClient: client})
		if resp != nil && resp.Body != nil {
			_ = resp.Body.Close()
		}
		if err != nil {
			return nil, err
		}
		c.SetReadLimit(maxMessageBytes)
		return wsConn{c}, nil
	}
}

type Stats struct {
	Parsed, Skipped, Rejected, Connects, Disconnects atomic.Int64
}

// Client mantiene la suscripción viva: ping periódico, reconexión con backoff exponencial + jitter.
type Client struct {
	URL          string
	Dial         Dialer
	PingInterval time.Duration
	Backoff      *resilience.Backoff
	Now          func() time.Time
	// OnStatus informa salud de la fuente (nil = sin reporte). err==nil ⇒ conexión viva.
	OnStatus func(err error)
	Stats    Stats
}

func NewClient(host string, backoffBase, backoffMax time.Duration) *Client {
	return &Client{
		URL:          "wss://" + host + Path,
		Dial:         AllowlistDialer(host),
		PingInterval: 15 * time.Second,
		Backoff:      resilience.NewBackoff(backoffBase, backoffMax),
		Now:          time.Now,
	}
}

func (c *Client) Name() string  { return SourceName }
func (c *Client) Enabled() bool { return true }

func (c *Client) status(err error) {
	if c.OnStatus != nil {
		c.OnStatus(err)
	}
}

// StableAfter: una sesión que duró al menos esto reinicia el backoff. Un servidor que acepta y corta
// de inmediato sigue escalando el backoff (nunca un bucle de reconexión agresivo).
const StableAfter = 30 * time.Second

// Run se mantiene conectado hasta que ctx se cancele; cada fallo espera Backoff.Next() (full jitter).
func (c *Client) Run(ctx context.Context, out chan<- sources.Observation) error {
	for {
		start := c.Now()
		err := c.session(ctx, out)
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if c.Now().Sub(start) >= StableAfter {
			c.Backoff.Reset()
		}
		c.Stats.Disconnects.Add(1)
		c.status(fmt.Errorf("emsc: disconnected: %w", err))
		if err := resilience.Sleep(ctx, c.Backoff.Next()); err != nil {
			return err
		}
	}
}

func (c *Client) session(ctx context.Context, out chan<- sources.Observation) error {
	conn, err := c.Dial(ctx, c.URL)
	if err != nil {
		return err
	}
	defer conn.Close()
	c.Stats.Connects.Add(1)
	c.status(nil)

	sctx, cancel := context.WithCancelCause(ctx)
	defer cancel(nil)
	go func() {
		t := time.NewTicker(c.PingInterval)
		defer t.Stop()
		for {
			select {
			case <-sctx.Done():
				return
			case <-t.C:
				pctx, pcancel := context.WithTimeout(sctx, c.PingInterval)
				err := conn.Ping(pctx)
				pcancel()
				if err != nil {
					cancel(fmt.Errorf("emsc: ping: %w", err))
					return
				}
				c.status(nil)
			}
		}
	}()

	for {
		b, err := conn.Read(sctx)
		if err != nil {
			if cause := context.Cause(sctx); cause != nil && ctx.Err() == nil {
				return cause
			}
			return err
		}
		c.status(nil)
		obs, err := ParseMessage(b, c.Now().UnixMilli())
		switch {
		case errors.Is(err, ErrSkip):
			c.Stats.Skipped.Add(1)
			continue
		case err != nil:
			c.Stats.Rejected.Add(1)
			continue
		}
		c.Stats.Parsed.Add(1)
		select {
		case out <- obs:
		case <-sctx.Done():
			return context.Cause(sctx)
		}
	}
}
