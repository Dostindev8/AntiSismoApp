// Package engine: decide, por celda geohash, si un evento es CRITICAL, INFORMATIVE o nada, y construye
// la alerta firmada (Ed25519) para cada topic. Solo memoria: sin Postgres (§0.3 regla 2).
package engine

import (
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"fmt"
	"math"
	"regexp"
	"time"

	"antisismo.app/decision/ipe"
	"antisismo.app/geo/geo"
	"antisismo.app/proto/contract"
)

type Threshold struct {
	MinMagnitude, MaxDistanceKm, MinExpectedMMI float64
}

// Config se construye desde packages/config/regions/{CODE}.yaml (nunca valores en código).
type Config struct {
	Region                 string
	Critical, Informative  Threshold
	ForceCriticalOnTsunami bool
	BBox                   geo.Box
	TopicPrecision         int           // 4 ⇒ celdas ~37×19 km
	Validity               time.Duration // iat→exp; ≤ contract.MaxAlarmWindowMs
	SWaveKmPerS            float64       // misma constante que apps/mobile/lib/core/geo/arrival.dart
}

var reRegion = regexp.MustCompile(`^[A-Z]{2}$`)

var ErrConfig = errors.New("engine: invalid config")

func (c Config) Validate() error {
	switch {
	case !reRegion.MatchString(c.Region):
		return fmt.Errorf("%w: region", ErrConfig)
	case c.TopicPrecision < 3 || c.TopicPrecision > 5:
		return fmt.Errorf("%w: topic precision must be 3..5 (coarse cells protect privacy)", ErrConfig)
	case c.Validity <= 0 || c.Validity.Milliseconds() > contract.MaxAlarmWindowMs:
		return fmt.Errorf("%w: validity", ErrConfig)
	case c.SWaveKmPerS <= 0:
		return fmt.Errorf("%w: s-wave velocity", ErrConfig)
	case c.Critical.MinExpectedMMI < 5:
		return fmt.Errorf("%w: CRITICAL requires expected MMI >= V", ErrConfig)
	case c.Critical.MaxDistanceKm > c.Informative.MaxDistanceKm:
		return fmt.Errorf("%w: critical radius > informative radius", ErrConfig)
	}
	return nil
}

type Level string

const (
	LevelCritical    Level = "CRITICAL"
	LevelInformative Level = "INFORMATIVE"
	LevelDrill       Level = "DRILL"
)

// CellDecision: resultado para una celda (topic alerts_{REGION}_{geohash}).
type CellDecision struct {
	Topic      string
	Cell       geo.Cell
	Level      Level
	Estimate   ipe.Estimate
	TEASeconds int // al centro de la celda, en el momento de decidir; el dispositivo recalcula con su ubicación
	Reason     string
}

func Topic(region, cell string) string { return "alerts_" + region + "_" + cell }

// Decide evalúa el evento contra los umbrales regionales. Orden de salida: CRITICAL primero y, dentro
// de cada nivel, celdas más cercanas primero (son las que menos tiempo de aviso tienen).
func Decide(ev contract.Event, cfg Config, nowMs int64) []CellDecision {
	if ev.Type != "EARTHQUAKE" {
		return nil // otros peligros usan sus propias configuraciones de contenido (F7 multi-hazard)
	}
	cells := geo.CellsWithin(ev.Lat, ev.Lon, cfg.Informative.MaxDistanceKm, cfg.TopicPrecision, cfg.BBox)
	var crit, info []CellDecision
	for _, c := range cells {
		rhyp := ipe.HypocentralKm(c.DistanceKm, math.Max(ev.DepthKm, 0))
		est := ipe.AllenEtAl2012Rhypo(ev.Magnitude, rhyp)
		d := CellDecision{Topic: Topic(cfg.Region, c.Hash), Cell: c, Estimate: est, TEASeconds: tea(rhyp, ev.TimeUTCms, nowMs, cfg.SWaveKmPerS)}
		switch {
		case ev.Tsunami && cfg.ForceCriticalOnTsunami && c.DistanceKm <= cfg.Critical.MaxDistanceKm:
			d.Level, d.Reason = LevelCritical, "tsunami-flag"
		case ev.Magnitude >= cfg.Critical.MinMagnitude && c.DistanceKm <= cfg.Critical.MaxDistanceKm && est.MMI >= cfg.Critical.MinExpectedMMI:
			d.Level, d.Reason = LevelCritical, "thresholds"
		case ev.Magnitude >= cfg.Informative.MinMagnitude && c.DistanceKm <= cfg.Informative.MaxDistanceKm && est.MMI >= cfg.Informative.MinExpectedMMI:
			d.Level, d.Reason = LevelInformative, "thresholds"
		default:
			continue
		}
		if d.Level == LevelCritical {
			crit = append(crit, d)
		} else {
			info = append(info, d)
		}
	}
	return append(crit, info...)
}

func tea(rhypKm float64, originMs, nowMs int64, vs float64) int {
	arrival := float64(originMs) + rhypKm/vs*1000
	s := int(math.Ceil((arrival - float64(nowMs)) / 1000))
	return max(0, min(s, 600))
}

// Signer abstrae la clave privada: en producción la firma ocurre en KMS/HSM (BLOCKERS BLK-03).
type Signer interface {
	Kid() string
	Sign(msg []byte) ([]byte, error)
}

// LocalSigner usa una clave Ed25519 en memoria (desarrollo y pruebas; nunca se registra ni se serializa).
type LocalSigner struct {
	kid  string
	priv ed25519.PrivateKey
}

var reKid = regexp.MustCompile(`^k-[a-z0-9-]{1,32}$`)

func NewLocalSigner(kid string, priv ed25519.PrivateKey) (*LocalSigner, error) {
	if !reKid.MatchString(kid) || len(priv) != ed25519.PrivateKeySize {
		return nil, fmt.Errorf("%w: signer kid/key", ErrConfig)
	}
	return &LocalSigner{kid: kid, priv: priv}, nil
}

// NewLocalSignerFromSeed: seed base64url de 32 bytes (desde secret manager vía variable de entorno).
func NewLocalSignerFromSeed(kid, seedB64 string) (*LocalSigner, error) {
	seed, err := base64.RawURLEncoding.DecodeString(seedB64)
	if err != nil || len(seed) != ed25519.SeedSize {
		return nil, fmt.Errorf("%w: signing seed must be 32 bytes base64url", ErrConfig)
	}
	return NewLocalSigner(kid, ed25519.NewKeyFromSeed(seed))
}

func (s *LocalSigner) Kid() string { return s.kid }
func (s *LocalSigner) Sign(msg []byte) ([]byte, error) {
	return ed25519.Sign(s.priv, msg), nil
}

// PublicKeyB64 devuelve la clave pública (base64url) para embeber en la app con su kid.
func (s *LocalSigner) PublicKeyB64() string {
	return base64.RawURLEncoding.EncodeToString(s.priv.Public().(ed25519.PublicKey))
}

func instructionFor(ev contract.Event) string {
	if ev.Tsunami {
		return "EVACUATE_HIGH_GROUND"
	}
	return "DROP_COVER_HOLD_ON"
}

// BuildSignedAlert crea el payload firmado para una celda. El alert_id es determinista
// (evento+revisión): reintentos y fuentes duplicadas producen exactamente la misma alerta.
func BuildSignedAlert(ev contract.Event, d CellDecision, cfg Config, nowMs int64, s Signer) (*contract.SignedAlert, error) {
	mmi := math.Round(d.Estimate.MMI*10) / 10
	rng := [2]float64{math.Round(d.Estimate.Low*10) / 10, math.Round(d.Estimate.High*10) / 10}
	tea := d.TEASeconds
	a := &contract.SignedAlert{
		V:       1,
		AlertID: contract.ComputeAlertID(ev.ID, ev.RevisionSeq),
		Level:   string(d.Level),
		Event: contract.AlertEvent{
			ID: ev.ID, Type: ev.Type, Magnitude: ev.Magnitude, MagType: ev.MagType, TimeUTCms: ev.TimeUTCms,
			Place: ev.Place, Lon: ev.Lon, Lat: ev.Lat, DepthKm: ev.DepthKm,
			MMIEstimatedRegional: &mmi, MMIRange: &rng, Tsunami: ev.Tsunami,
			SolutionStatus: ev.SolutionStatus, RevisionSeq: ev.RevisionSeq, TEARegionalSeconds: &tea,
		},
		Instruction:  instructionFor(ev),
		Voice:        contract.Voice{SpeakName: true},
		IatMs:        nowMs,
		ExpMs:        nowMs + cfg.Validity.Milliseconds(),
		ServerTimeMs: nowMs,
	}
	sig, err := s.Sign([]byte(a.CanonicalString()))
	if err != nil {
		return nil, fmt.Errorf("engine: sign: %w", err)
	}
	// El kid se fija DESPUÉS de firmar (no forma parte de la cadena canónica): un firmante con respaldo
	// puede haber usado la clave secundaria y el kid debe identificar la clave que realmente firmó.
	a.Kid, a.Sig = s.Kid(), base64.RawURLEncoding.EncodeToString(sig)
	return a, nil
}
