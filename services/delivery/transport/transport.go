// Package transport: envío a FCM HTTP v1 (Android + APNs vía FCM). Las credenciales nunca viven en
// el repo: el token OAuth2 lo provee un TokenSource conectado al secret manager (BLOCKERS BLK-01/02).
package transport

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"time"
)

// Message = un push a un topic de celda.
type Message struct {
	Topic       string
	Level       string // CRITICAL | INFORMATIVE | DRILL
	AlertID     string
	Payload     []byte // SignedAlert JSON (verificado en el dispositivo)
	Title, Body string // textos localizados (packages/config/i18n), nunca en código
	TTL         time.Duration
}

type Transport interface {
	Name() string
	Send(ctx context.Context, m Message) error
}

var (
	// ErrPermanent: no reintentar (petición inválida, topic inexistente, permiso denegado).
	ErrPermanent = errors.New("transport: permanent failure")
	// ErrNotConfigured: faltan credenciales. Las alertas NO se entregan; va a DLQ con alarma operativa.
	ErrNotConfigured = errors.New("transport: push provider not configured (BLK-01)")
	reTopic          = regexp.MustCompile(`^[a-zA-Z0-9_.~%-]{1,900}$`)
	reProject        = regexp.MustCompile(`^[a-z][a-z0-9-]{4,61}[a-z0-9]$`)
)

type TokenSource interface {
	Token(ctx context.Context) (string, error)
}

// FCM implementa FCM HTTP v1 (POST /v1/projects/{id}/messages:send).
type FCM struct {
	ProjectID string
	Endpoint  string // https://fcm.googleapis.com (sobrescribible solo en pruebas)
	Client    *http.Client
	Tokens    TokenSource
}

func (f *FCM) Name() string { return "fcm" }

type apsSound struct {
	Critical int     `json:"critical"`
	Name     string  `json:"name"`
	Volume   float64 `json:"volume"`
}

// Body construye el JSON de FCM. CRITICAL: Android prioridad HIGH; iOS Critical Alert (sonido crítico,
// interruption-level critical; requiere entitlement aprobado por Apple, BLK-02).
func Body(m Message) ([]byte, error) {
	if !reTopic.MatchString(m.Topic) || len(m.Payload) == 0 || len(m.Payload) > 3500 {
		return nil, fmt.Errorf("%w: invalid topic or payload size", ErrPermanent)
	}
	ttl := m.TTL
	if ttl <= 0 {
		ttl = 5 * time.Minute
	}
	critical := m.Level == "CRITICAL"
	androidPriority, apnsPriority, interruption := "NORMAL", "5", "active"
	var sound any = "default"
	if critical {
		androidPriority, apnsPriority, interruption = "HIGH", "10", "critical"
		sound = apsSound{Critical: 1, Name: "alarm.caf", Volume: 1.0}
	}
	msg := map[string]any{
		"topic": m.Topic,
		"data":  map[string]string{"alert": string(m.Payload), "alert_id": m.AlertID, "level": m.Level},
		"android": map[string]any{
			"priority": androidPriority,
			"ttl":      fmt.Sprintf("%ds", int(ttl.Seconds())),
		},
		"apns": map[string]any{
			"headers": map[string]string{
				"apns-priority":    apnsPriority,
				"apns-push-type":   "alert",
				"apns-expiration":  fmt.Sprint(time.Now().Add(ttl).Unix()),
				"apns-collapse-id": m.AlertID[:min(64, len(m.AlertID))],
			},
			"payload": map[string]any{
				"aps": map[string]any{
					"alert":              map[string]string{"title": m.Title, "body": m.Body},
					"sound":              sound,
					"interruption-level": interruption,
					"mutable-content":    1,
				},
			},
		},
	}
	return json.Marshal(map[string]any{"message": msg})
}

func (f *FCM) Send(ctx context.Context, m Message) error {
	if f.Tokens == nil || !reProject.MatchString(f.ProjectID) {
		return ErrNotConfigured
	}
	body, err := Body(m)
	if err != nil {
		return err
	}
	tok, err := f.Tokens.Token(ctx)
	if err != nil {
		return fmt.Errorf("transport: token: %w", err)
	}
	endpoint := f.Endpoint
	if endpoint == "" {
		endpoint = "https://fcm.googleapis.com"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint+"/v1/projects/"+f.ProjectID+"/messages:send", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+tok)
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	resp, err := f.Client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
	switch {
	case resp.StatusCode == http.StatusOK:
		return nil
	case resp.StatusCode == http.StatusBadRequest, resp.StatusCode == http.StatusForbidden, resp.StatusCode == http.StatusNotFound:
		return fmt.Errorf("%w: fcm status %d", ErrPermanent, resp.StatusCode)
	default: // 401 (token caducado), 429, 5xx: reintentar con backoff
		return fmt.Errorf("transport: fcm status %d", resp.StatusCode)
	}
}

// Unconfigured es el transporte cuando faltan credenciales: falla siempre de forma visible.
type Unconfigured struct{}

func (Unconfigured) Name() string                        { return "unconfigured" }
func (Unconfigured) Send(context.Context, Message) error { return ErrNotConfigured }

// IsPermanent indica si no tiene sentido reintentar.
func IsPermanent(err error) bool {
	return errors.Is(err, ErrPermanent) || errors.Is(err, ErrNotConfigured)
}
