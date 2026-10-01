// Package sources define el contrato común de proveedores de alertas (§3#18).
package sources

import (
	"context"

	"antisismo.app/proto/contract"
)

// Observation es un reporte de una fuente antes de deduplicar. Event.ID/RevisionSeq los asigna el pipeline.
type Observation struct {
	Source          string
	SourceID        string
	SourceUpdatedMs int64
	Event           contract.Event
}

// AlertSourceProvider: cada fuente (USGS, EMSC, CNS-DO, COE, PTWC/CAP, SASMEX) implementa esta interfaz.
// Los conectores oficiales sin documentación verificada se registran con Enabled()==false (nunca inventar endpoints).
type AlertSourceProvider interface {
	Name() string
	Enabled() bool
	// Run emite observaciones hasta que ctx se cancele. Debe reintentar internamente con backoff+jitter.
	Run(ctx context.Context, out chan<- Observation) error
}

// Disabled es el conector de una fuente pendiente de verificación oficial (BLOCKERS.md BLK-04/BLK-05).
type Disabled struct {
	SourceName string
	Note       string
}

func (d Disabled) Name() string  { return d.SourceName }
func (d Disabled) Enabled() bool { return false }
func (d Disabled) Run(ctx context.Context, _ chan<- Observation) error {
	<-ctx.Done()
	return ctx.Err()
}
