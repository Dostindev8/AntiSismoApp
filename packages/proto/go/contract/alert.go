package contract

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// MaxAlarmWindowMs acota iat→exp para que un push firmado no sirva como alarma indefinidamente.
const MaxAlarmWindowMs int64 = 10 * 60 * 1000

var (
	reAlertID = regexp.MustCompile(`^[0-9a-f]{64}$`)
	reKid     = regexp.MustCompile(`^k-[a-z0-9-]{1,32}$`)
	reSig     = regexp.MustCompile(`^[A-Za-z0-9_-]{86}$`)
	levelSet  = map[string]bool{"CRITICAL": true, "INFORMATIVE": true, "DRILL": true}
	instrSet  = map[string]bool{"DROP_COVER_HOLD_ON": true, "EVACUATE_HIGH_GROUND": true, "FLOOD_MOVE_AWAY": true, "FOLLOW_AUTHORITIES": true}
)

type AlertEvent struct {
	ID                   string      `json:"id"`
	Type                 string      `json:"type"`
	Magnitude            float64     `json:"magnitude"`
	MagType              string      `json:"mag_type"`
	TimeUTCms            int64       `json:"time_utc_ms"`
	Place                string      `json:"place"`
	Lon                  float64     `json:"lon"`
	Lat                  float64     `json:"lat"`
	DepthKm              float64     `json:"depth_km"`
	MMIEstimatedRegional *float64    `json:"mmi_estimated_regional"`
	MMIRange             *[2]float64 `json:"mmi_range"`
	Tsunami              bool        `json:"tsunami"`
	SolutionStatus       string      `json:"solution_status"`
	RevisionSeq          int         `json:"revision_seq"`
	TEARegionalSeconds   *int        `json:"tea_regional_seconds"`
}

type Voice struct {
	SpeakName bool `json:"speak_name"`
}

// SignedAlert = payload de push firmado (§7.2).
type SignedAlert struct {
	V            int        `json:"v"`
	AlertID      string     `json:"alert_id"`
	Level        string     `json:"level"`
	Event        AlertEvent `json:"event"`
	Instruction  string     `json:"instruction"`
	Voice        Voice      `json:"voice"`
	IatMs        int64      `json:"iat_ms"`
	ExpMs        int64      `json:"exp_ms"`
	ServerTimeMs int64      `json:"server_time_ms"`
	Kid          string     `json:"kid"`
	Sig          string     `json:"sig"`
}

// ComputeAlertID = hex(sha256(event.id + ":" + revision_seq)).
func ComputeAlertID(eventID string, revisionSeq int) string {
	sum := sha256.Sum256([]byte(eventID + ":" + strconv.Itoa(revisionSeq)))
	return hex.EncodeToString(sum[:])
}

// CanonicalString = contrato fijo v1 que cubre la firma Ed25519.
func (a *SignedAlert) CanonicalString() string {
	return strings.Join([]string{
		"v1", a.AlertID, a.Event.ID, strconv.Itoa(a.Event.RevisionSeq),
		strconv.FormatInt(a.Event.TimeUTCms, 10), strconv.FormatInt(a.IatMs, 10),
		strconv.FormatInt(a.ExpMs, 10), a.Level, a.Instruction,
	}, "\n")
}

// Sign firma con la clave privada (en producción la operación ocurre en KMS/HSM).
func (a *SignedAlert) Sign(priv ed25519.PrivateKey) {
	a.Sig = base64.RawURLEncoding.EncodeToString(ed25519.Sign(priv, []byte(a.CanonicalString())))
}

func (a *SignedAlert) VerifySignature(publicKeysByKid map[string]string) bool {
	pkB64, ok := publicKeysByKid[a.Kid]
	if !ok {
		return false
	}
	pk, err := base64.RawURLEncoding.DecodeString(pkB64)
	if err != nil || len(pk) != ed25519.PublicKeySize {
		return false
	}
	sig, err := base64.RawURLEncoding.DecodeString(a.Sig)
	if err != nil || len(sig) != ed25519.SignatureSize {
		return false
	}
	return ed25519.Verify(ed25519.PublicKey(pk), []byte(a.CanonicalString()), sig)
}

func (a *SignedAlert) validateShape() error {
	e := a.Event
	inMMI := func(v float64) bool { return v >= 1 && v <= 12 }
	switch {
	case a.V != 1, !reAlertID.MatchString(a.AlertID), !levelSet[a.Level], !instrSet[a.Instruction],
		!reKid.MatchString(a.Kid), !reSig.MatchString(a.Sig),
		a.IatMs < MinEpochMs, a.ExpMs < MinEpochMs, a.ServerTimeMs < MinEpochMs:
		return ErrInvalid
	case !reUUID.MatchString(e.ID), !hazardSet[e.Type], e.Magnitude < -2, e.Magnitude > 10,
		!reMagType.MatchString(e.MagType), e.TimeUTCms < MinEpochMs, e.TimeUTCms > maxEpochMs,
		UTF16Len(e.Place) > MaxPlaceUnits, reUnsafe.MatchString(e.Place),
		e.Lon < -180, e.Lon > 180, e.Lat < -90, e.Lat > 90, e.DepthKm < -100, e.DepthKm > 1000,
		!statusSet[e.SolutionStatus], e.RevisionSeq < 0, e.RevisionSeq > 10_000:
		return ErrInvalid
	case e.MMIEstimatedRegional != nil && !inMMI(*e.MMIEstimatedRegional),
		e.MMIRange != nil && (!inMMI(e.MMIRange[0]) || !inMMI(e.MMIRange[1])),
		e.TEARegionalSeconds != nil && (*e.TEARegionalSeconds < 0 || *e.TEARegionalSeconds > 600):
		return ErrInvalid
	}
	return nil
}

var requiredAlertKeys = []string{"v", "alert_id", "level", "event", "instruction", "voice", "iat_ms", "exp_ms", "server_time_ms", "kid", "sig"}
var requiredAlertEventKeys = []string{
	"id", "type", "magnitude", "mag_type", "time_utc_ms", "place", "lon", "lat", "depth_km",
	"mmi_estimated_regional", "mmi_range", "tsunami", "solution_status", "revision_seq", "tea_regional_seconds",
}

func DecodeSignedAlert(data []byte) (*SignedAlert, error) {
	var top map[string]json.RawMessage
	if err := json.Unmarshal(data, &top); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	for _, k := range requiredAlertKeys {
		if _, ok := top[k]; !ok {
			return nil, fmt.Errorf("%w: missing %s", ErrInvalid, k)
		}
	}
	var ev map[string]json.RawMessage
	if err := json.Unmarshal(top["event"], &ev); err != nil {
		return nil, fmt.Errorf("%w: event", ErrInvalid)
	}
	for _, k := range requiredAlertEventKeys {
		if _, ok := ev[k]; !ok {
			return nil, fmt.Errorf("%w: missing event.%s", ErrInvalid, k)
		}
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	var a SignedAlert
	if err := dec.Decode(&a); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	if err := a.validateShape(); err != nil {
		return nil, err
	}
	return &a, nil
}

// Action es la decisión fail-safe del cliente ante un push (ver packages/proto/src/index.ts).
type Action string

const (
	ActionAlarm       Action = "ALARM"
	ActionInformative Action = "INFORMATIVE"
	ActionDrill       Action = "DRILL"
	ActionReconcile   Action = "RECONCILE"
)

// Classify: nowMs debe venir corregido con el offset de reloj conocido.
func Classify(data []byte, nowMs int64, publicKeysByKid map[string]string) (Action, string) {
	a, err := DecodeSignedAlert(data)
	if err != nil {
		return ActionReconcile, "schema"
	}
	if a.ExpMs <= a.IatMs || a.ExpMs-a.IatMs > MaxAlarmWindowMs {
		return ActionReconcile, "validity-window"
	}
	if ComputeAlertID(a.Event.ID, a.Event.RevisionSeq) != a.AlertID {
		return ActionReconcile, "alert-id"
	}
	if !a.VerifySignature(publicKeysByKid) {
		return ActionReconcile, "signature"
	}
	if a.Level == "DRILL" {
		return ActionDrill, "drill"
	}
	if nowMs > a.ExpMs {
		return ActionInformative, "expired"
	}
	if a.Level == "INFORMATIVE" {
		return ActionInformative, "level"
	}
	return ActionAlarm, "ok"
}
