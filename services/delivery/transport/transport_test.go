package transport

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type staticToken string

func (s staticToken) Token(context.Context) (string, error) { return string(s), nil }

type failToken struct{}

func (failToken) Token(context.Context) (string, error) { return "", errors.New("kms down") }

func msg(level string) Message {
	return Message{Topic: "alerts_DO_d7q3", Level: level, AlertID: "abc123", Payload: []byte(`{"v":1}`), Title: "Sismo", Body: "Agáchate"}
}

func TestBodyCriticalUsesHighPriorityAndCriticalSound(t *testing.T) {
	b, err := Body(msg("CRITICAL"))
	if err != nil {
		t.Fatal(err)
	}
	var got struct {
		Message struct {
			Topic   string            `json:"topic"`
			Data    map[string]string `json:"data"`
			Android struct {
				Priority string `json:"priority"`
				TTL      string `json:"ttl"`
			} `json:"android"`
			APNs struct {
				Headers map[string]string `json:"headers"`
				Payload struct {
					APS struct {
						Sound        apsSound `json:"sound"`
						Interruption string   `json:"interruption-level"`
						Alert        struct{ Title, Body string }
					} `json:"aps"`
				} `json:"payload"`
			} `json:"apns"`
		} `json:"message"`
	}
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatal(err)
	}
	m := got.Message
	if m.Topic != "alerts_DO_d7q3" || m.Data["alert"] != `{"v":1}` || m.Data["alert_id"] != "abc123" || m.Data["level"] != "CRITICAL" {
		t.Fatalf("data: %+v", m)
	}
	if m.Android.Priority != "HIGH" || m.Android.TTL != "300s" {
		t.Fatalf("android: %+v", m.Android)
	}
	h := m.APNs.Headers
	if h["apns-priority"] != "10" || h["apns-push-type"] != "alert" || h["apns-collapse-id"] != "abc123" || h["apns-expiration"] == "" {
		t.Fatalf("apns headers: %+v", h)
	}
	aps := m.APNs.Payload.APS
	if aps.Sound.Critical != 1 || aps.Sound.Name != "alarm.caf" || aps.Interruption != "critical" || aps.Alert.Title != "Sismo" {
		t.Fatalf("aps: %+v", aps)
	}
}

func TestBodyInformativeIsNotIntrusive(t *testing.T) {
	b, err := Body(msg("INFORMATIVE"))
	if err != nil {
		t.Fatal(err)
	}
	s := string(b)
	for _, want := range []string{`"priority":"NORMAL"`, `"apns-priority":"5"`, `"interruption-level":"active"`, `"sound":"default"`} {
		if !strings.Contains(s, want) {
			t.Fatalf("missing %s in %s", want, s)
		}
	}
}

func TestBodyRejectsInvalidInput(t *testing.T) {
	for name, m := range map[string]Message{
		"topic injection": {Topic: "a/b", Payload: []byte("x")},
		"empty payload":   {Topic: "t"},
		"oversize":        {Topic: "t", Payload: make([]byte, 3501)},
	} {
		if _, err := Body(m); !errors.Is(err, ErrPermanent) {
			t.Errorf("%s: want ErrPermanent, got %v", name, err)
		}
	}
}

func TestFCMSendStatusMapping(t *testing.T) {
	cases := map[int]struct{ ok, permanent bool }{
		200: {ok: true}, 400: {permanent: true}, 403: {permanent: true}, 404: {permanent: true},
		401: {}, 429: {}, 500: {}, 503: {},
	}
	for status, want := range cases {
		var gotAuth, gotPath string
		srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			gotAuth, gotPath = r.Header.Get("Authorization"), r.URL.Path
			_, _ = io.Copy(io.Discard, r.Body)
			w.WriteHeader(status)
		}))
		f := &FCM{ProjectID: "antisismo-test", Endpoint: srv.URL, Client: srv.Client(), Tokens: staticToken("tok")}
		err := f.Send(context.Background(), msg("CRITICAL"))
		srv.Close()
		if (err == nil) != want.ok || IsPermanent(err) != want.permanent {
			t.Errorf("status %d: err=%v permanent=%v", status, err, IsPermanent(err))
		}
		if gotAuth != "Bearer tok" || gotPath != "/v1/projects/antisismo-test/messages:send" {
			t.Errorf("status %d: auth=%q path=%q", status, gotAuth, gotPath)
		}
	}
}

func TestFCMNotConfiguredAndTokenFailure(t *testing.T) {
	ctx := context.Background()
	if err := (&FCM{ProjectID: "antisismo-test"}).Send(ctx, msg("CRITICAL")); !errors.Is(err, ErrNotConfigured) || !IsPermanent(err) {
		t.Fatalf("missing tokens: %v", err)
	}
	if err := (&FCM{ProjectID: "../evil", Tokens: staticToken("t")}).Send(ctx, msg("CRITICAL")); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("invalid project id must be rejected: %v", err)
	}
	err := (&FCM{ProjectID: "antisismo-test", Tokens: failToken{}, Client: http.DefaultClient}).Send(ctx, msg("CRITICAL"))
	if err == nil || IsPermanent(err) {
		t.Fatalf("token failure must be retryable: %v", err)
	}
	if err := (Unconfigured{}).Send(ctx, msg("CRITICAL")); !errors.Is(err, ErrNotConfigured) || (Unconfigured{}).Name() != "unconfigured" || (&FCM{}).Name() != "fcm" {
		t.Fatal("unconfigured transport must fail visibly")
	}
}

func TestFCMNetworkErrorIsRetryable(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	client := srv.Client()
	srv.Close()
	err := (&FCM{ProjectID: "antisismo-test", Endpoint: srv.URL, Client: client, Tokens: staticToken("t")}).Send(context.Background(), msg("CRITICAL"))
	if err == nil || IsPermanent(err) {
		t.Fatalf("network error must be retryable: %v", err)
	}
}
