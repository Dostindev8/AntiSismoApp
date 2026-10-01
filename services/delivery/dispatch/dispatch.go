// Package dispatch une decisión y entrega: por cada evento/revisión decide por celda, firma y encola.
//
// Reglas de revisión (fatiga cero, nunca cancelar):
//   - Una celda que ya recibió CRITICAL para un evento nunca vuelve a sonar: las revisiones le llegan
//     como INFORMATIVE (actualizan la tarjeta).
//   - Una revisión que sube de INFORMATIVE/nada a CRITICAL sí alarma (más peligro ⇒ avisar).
//   - Una revisión que baja o deja la celda fuera de umbral nunca envía "cancelación".
package dispatch

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"antisismo.app/decision/engine"
	"antisismo.app/delivery/metrics"
	"antisismo.app/delivery/queue"
	"antisismo.app/geo/geo"
	"antisismo.app/ingestion/regioncfg"
	"antisismo.app/proto/contract"
)

// Constantes físicas compartidas con la app (apps/mobile/lib/core/arrival.dart): no son umbrales regionales.
const (
	SWaveKmPerS    = 3.5
	TopicPrecision = 4 // geohash-4 ≈ 39×20 km: el servidor nunca conoce la ubicación exacta
	AlertValidity  = 5 * time.Minute
)

// EngineConfig traduce la configuración regional (packages/config/regions) al motor de decisión.
func EngineConfig(r *regioncfg.Region) (engine.Config, error) {
	c := engine.Config{
		Region:                 r.Region,
		Critical:               engine.Threshold(r.Thresholds.Critical),
		Informative:            engine.Threshold(r.Thresholds.Informative),
		ForceCriticalOnTsunami: r.Tsunami.ForceCriticalOnFlag,
		BBox:                   geo.Box{MinLat: r.BBox.MinLat, MaxLat: r.BBox.MaxLat, MinLon: r.BBox.MinLon, MaxLon: r.BBox.MaxLon},
		TopicPrecision:         TopicPrecision,
		Validity:               AlertValidity,
		SWaveKmPerS:            SWaveKmPerS,
	}
	return c, c.Validate()
}

// Texts: textos de notificación del sistema (bandeja). Fuente: packages/config/i18n/{locale}.json.
type Texts map[string]string

// LoadTexts carga el locale base es-DO y aplica el override del locale pedido.
func LoadTexts(dir, locale string) (Texts, error) {
	t := Texts{}
	for _, l := range []string{"es-DO", locale} {
		b, err := os.ReadFile(filepath.Join(dir, l+".json"))
		if err != nil {
			if l == locale && errors.Is(err, os.ErrNotExist) {
				continue
			}
			return nil, err
		}
		var m map[string]string
		if err := json.Unmarshal(b, &m); err != nil {
			return nil, fmt.Errorf("dispatch: i18n %s: %w", l, err)
		}
		for k, v := range m {
			t[k] = v
		}
	}
	for _, k := range []string{"alert.title.earthquake", "alert.title.tsunami", "alert.informative.title", "push.informative.body", "instruction.DROP_COVER_HOLD_ON", "instruction.EVACUATE_HIGH_GROUND"} {
		if t[k] == "" {
			return nil, fmt.Errorf("dispatch: missing i18n key %s", k)
		}
	}
	return t, nil
}

func (t Texts) format(key string, params map[string]string) string {
	s := t[key]
	for k, v := range params {
		s = strings.ReplaceAll(s, "{"+k+"}", v)
	}
	return s
}

// FallbackSigner: si el firmante primario (KMS) falla, firma con la clave "siguiente" (otro kid
// embebido en la app). Ambas claves públicas están en el dispositivo, así que la alerta sigue verificable.
// Una instancia se usa para UNA sola alerta: Kid() devuelve la clave que realmente firmó.
type FallbackSigner struct {
	Primary, Secondary engine.Signer
	used               engine.Signer
}

func (f *FallbackSigner) Kid() string {
	if f.used != nil {
		return f.used.Kid()
	}
	return f.Primary.Kid()
}

func (f *FallbackSigner) Sign(msg []byte) ([]byte, error) {
	used, sig, err := f.pick(msg)
	if err != nil {
		return nil, err
	}
	f.used = used
	return sig, nil
}

func (f *FallbackSigner) pick(msg []byte) (engine.Signer, []byte, error) {
	sig, err := f.Primary.Sign(msg)
	if err == nil {
		return f.Primary, sig, nil
	}
	if f.Secondary == nil {
		return nil, nil, err
	}
	sig2, err2 := f.Secondary.Sign(msg)
	if err2 != nil {
		return nil, nil, errors.Join(err, err2)
	}
	return f.Secondary, sig2, nil
}

type Dispatcher struct {
	Cfg     engine.Config
	Primary engine.Signer
	Backup  engine.Signer // opcional: clave "siguiente" para continuidad si el KMS primario falla
	Queue   queue.Queue
	Texts   Texts
	Metrics *metrics.Delivery
	Log     *slog.Logger
	Now     func() time.Time

	mu   sync.Mutex
	sent map[string]map[string]engine.Level // event_id → topic → nivel más alto enviado
	seen map[string]int64                   // event_id → time_utc_ms (para poda)
}

func (d *Dispatcher) init() {
	if d.sent == nil {
		d.sent, d.seen = map[string]map[string]engine.Level{}, map[string]int64{}
	}
	if d.Now == nil {
		d.Now = time.Now
	}
	if d.Log == nil {
		d.Log = slog.Default()
	}
}

func priority(l engine.Level) queue.Priority {
	switch l {
	case engine.LevelCritical:
		return queue.Critical
	case engine.LevelDrill:
		return queue.Drill
	}
	return queue.Informative
}

// Handle procesa un evento nuevo o una revisión. Devuelve el número de trabajos encolados.
func (d *Dispatcher) Handle(ctx context.Context, ev contract.Event) (int, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.init()
	now := d.Now().UnixMilli()
	decisions := engine.Decide(ev, d.Cfg, now)
	if len(decisions) == 0 {
		return 0, nil
	}
	prev := d.sent[ev.ID]
	if prev == nil {
		prev = map[string]engine.Level{}
		d.sent[ev.ID], d.seen[ev.ID] = prev, ev.TimeUTCms
	}
	n := 0
	var errs []error
	for _, dec := range decisions {
		if prev[dec.Topic] == engine.LevelCritical {
			dec.Level = engine.LevelInformative // ya sonó: solo actualizar la tarjeta
		}
		job, err := d.job(ev, dec, now)
		if err != nil {
			errs = append(errs, err)
			continue
		}
		if err := d.Queue.Push(ctx, job); err != nil {
			errs = append(errs, err)
			d.Log.Error("enqueue failed", "event", "enqueue_failed", "alert_id", job.AlertID, "topic", job.Topic, "error", err.Error())
			continue
		}
		if prev[dec.Topic] != engine.LevelCritical {
			prev[dec.Topic] = dec.Level
		}
		n++
	}
	return n, errors.Join(errs...)
}

func (d *Dispatcher) job(ev contract.Event, dec engine.CellDecision, now int64) (queue.Job, error) {
	alert, err := engine.BuildSignedAlert(ev, dec, d.Cfg, now, &FallbackSigner{Primary: d.Primary, Secondary: d.Backup})
	var payload []byte
	if err != nil {
		// Sin firma posible: el push sale igual (alta prioridad) con un payload de reconciliación que
		// el dispositivo no puede tomar como alarma; lo confirma por TLS. Nunca silencio, nunca alarma falsa.
		d.Metrics.SignFailures.Add(1)
		d.Log.Error("signing failed; sending reconcile push", "event", "sign_failed", "event_id", ev.ID, "error", err.Error())
		payload, _ = json.Marshal(map[string]any{"v": 1, "reconcile": true, "event_id": ev.ID, "revision_seq": ev.RevisionSeq, "server_time_ms": now})
	} else if payload, err = json.Marshal(alert); err != nil {
		return queue.Job{}, err
	}
	alertID := contract.ComputeAlertID(ev.ID, ev.RevisionSeq)
	title, body := d.texts(ev, dec)
	return queue.Job{
		ID: alertID + ":" + dec.Topic, AlertID: alertID, Topic: dec.Topic, Level: string(dec.Level),
		Priority: priority(dec.Level), Payload: payload, Title: title, Body: body,
		ReceivedAtMs: ev.ReceivedAtMs, EnqueuedAtMs: d.Now().UnixMilli(),
	}, nil
}

func (d *Dispatcher) texts(ev contract.Event, dec engine.CellDecision) (string, string) {
	if dec.Level == engine.LevelCritical {
		if ev.Tsunami {
			return d.Texts["alert.title.tsunami"], d.Texts["instruction.EVACUATE_HIGH_GROUND"]
		}
		return d.Texts["alert.title.earthquake"], d.Texts["instruction.DROP_COVER_HOLD_ON"]
	}
	return d.Texts["alert.informative.title"], d.Texts.format("push.informative.body", map[string]string{
		"magnitude": strconv.FormatFloat(ev.Magnitude, 'f', 1, 64), "place": ev.Place,
	})
}

// Prune olvida eventos más viejos que retention (memoria acotada).
func (d *Dispatcher) Prune(nowMs int64, retention time.Duration) int {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.init()
	n := 0
	for id, t := range d.seen {
		if nowMs-t > retention.Milliseconds() {
			delete(d.seen, id)
			delete(d.sent, id)
			n++
		}
	}
	return n
}
