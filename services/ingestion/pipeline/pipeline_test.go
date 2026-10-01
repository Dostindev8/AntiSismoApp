package pipeline

import (
	"sync"
	"testing"
	"time"

	"antisismo.app/ingestion/normalize"
	"antisismo.app/ingestion/sources"
	"antisismo.app/proto/contract"
)

const t0 int64 = 1790627527000

func obs(src, sid string, mag float64, tMs, updated int64, lat, lon float64, status string) sources.Observation {
	return sources.Observation{Source: src, SourceID: sid, SourceUpdatedMs: updated, Event: contract.Event{
		ID: normalize.EventID(src, sid), SourceIDs: map[string]string{src: sid}, Type: "EARTHQUAKE",
		Magnitude: mag, MagType: "Mw", TimeUTCms: tMs, ReceivedAtMs: updated, Lat: lat, Lon: lon,
		DepthKm: 35, Place: "Frente a la costa norte de RD", SolutionStatus: status,
	}}
}

func TestNewThenDuplicateFromSecondSource(t *testing.T) {
	p := New(normalize.DefaultDedup, time.Hour)
	e1, k1 := p.Ingest(obs("emsc", "E1", 6.4, t0, t0+2000, 19.7, -69.9, "automatic"))
	if k1 != KindNew || e1.RevisionSeq != 0 {
		t.Fatalf("first observation must be new rev 0: %v %d", k1, e1.RevisionSeq)
	}
	e2, k2 := p.Ingest(obs("usgs", "U1", 6.4, t0+1500, t0+5000, 19.71, -69.92, "automatic"))
	if k2 != KindNone || e2.ID != e1.ID || len(e2.SourceIDs) != 2 {
		t.Fatalf("second source must merge without new alert: kind=%v ids=%v", k2, e2.SourceIDs)
	}
}

func TestRevisionHistory64To62(t *testing.T) {
	p := New(normalize.DefaultDedup, time.Hour)
	e, _ := p.Ingest(obs("usgs", "U1", 6.4, t0, t0+2000, 19.7, -69.9, "automatic"))
	_, k := p.Ingest(obs("usgs", "U1", 6.2, t0, t0+600000, 19.72, -69.93, "reviewed"))
	if k != KindRevision {
		t.Fatalf("expected revision, got %v", k)
	}
	h := p.History(e.ID)
	if len(h) != 2 || h[0].Magnitude != 6.4 || h[1].Magnitude != 6.2 || h[1].Seq != 1 || h[1].Status != "reviewed" {
		t.Fatalf("history = %+v", h)
	}
	if contract.ComputeAlertID(e.ID, 0) == contract.ComputeAlertID(e.ID, 1) {
		t.Fatal("each revision must have a distinct alert_id")
	}
}

func TestStaleAndImmaterialUpdatesIgnored(t *testing.T) {
	p := New(normalize.DefaultDedup, time.Hour)
	p.Ingest(obs("usgs", "U1", 6.4, t0, t0+5000, 19.7, -69.9, "automatic"))
	if _, k := p.Ingest(obs("usgs", "U1", 5.0, t0, t0+4000, 19.7, -69.9, "automatic")); k != KindNone {
		t.Fatal("older 'updated' must be ignored")
	}
	if _, k := p.Ingest(obs("usgs", "U1", 6.43, t0, t0+9000, 19.7001, -69.9, "automatic")); k != KindNone {
		t.Fatal("rounding noise must not create a revision")
	}
}

func TestSecondarySourceReviewedSolutionTakesOver(t *testing.T) {
	p := New(normalize.DefaultDedup, time.Hour)
	p.Ingest(obs("emsc", "E1", 6.4, t0, t0+2000, 19.7, -69.9, "automatic"))
	e, k := p.Ingest(obs("usgs", "U1", 6.1, t0+1000, t0+900000, 19.75, -69.95, "reviewed"))
	if k != KindRevision || e.Magnitude != 6.1 || e.SolutionStatus != "reviewed" {
		t.Fatalf("reviewed solution from secondary source must revise: kind=%v %+v", k, e)
	}
	if _, k := p.Ingest(obs("emsc", "E1", 6.6, t0, t0+950000, 19.7, -69.9, "automatic")); k != KindNone {
		t.Fatal("former primary automatic update must not override a reviewed solution")
	}
}

func TestReviewedNotOverwrittenByAutomaticAndTsunamiSticky(t *testing.T) {
	p := New(normalize.DefaultDedup, time.Hour)
	o := obs("usgs", "U1", 7.1, t0, t0+5000, 19.7, -69.9, "reviewed")
	o.Event.Tsunami = true
	p.Ingest(o)
	e, k := p.Ingest(obs("emsc", "E1", 6.5, t0+1000, t0+6000, 19.75, -69.95, "automatic"))
	if k != KindNone || e.Magnitude != 7.1 || !e.Tsunami {
		t.Fatalf("reviewed solution must win and tsunami flag must stay: %+v kind=%v", e, k)
	}
}

func TestDistinctAftershockNotMerged(t *testing.T) {
	p := New(normalize.DefaultDedup, time.Hour)
	p.Ingest(obs("usgs", "U1", 4.0, t0, t0+2000, 19.7, -69.9, "automatic"))
	if _, k := p.Ingest(obs("usgs", "U2", 5.8, t0+10000, t0+12000, 20.24, -69.9, "automatic")); k != KindNew {
		t.Fatal("ΔM > 1.5 must be a separate event")
	}
}

func TestPruneBoundsMemory(t *testing.T) {
	p := New(normalize.DefaultDedup, time.Hour)
	p.Ingest(obs("usgs", "OLD", 5, t0, t0+1, 19.7, -69.9, "automatic"))
	p.Ingest(obs("usgs", "NEW", 5, t0+2*3600_000, t0+2*3600_000, 10, 10, "automatic"))
	if n := p.Prune(t0 + 2*3600_000); n != 1 {
		t.Fatalf("pruned %d", n)
	}
	if _, k := p.Ingest(obs("usgs", "OLD", 5, t0, t0+99, 19.7, -69.9, "automatic")); k != KindNew {
		t.Fatal("pruned source key must be forgotten")
	}
}

func TestConcurrentIngestIsSafe(t *testing.T) {
	p := New(normalize.DefaultDedup, time.Hour)
	var wg sync.WaitGroup
	news := make(chan struct{}, 200)
	for i := 0; i < 200; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			src := []string{"usgs", "emsc"}[i%2]
			if _, k := p.Ingest(obs(src, src+"-X", 6.0, t0, t0+int64(i), 19.7, -69.9, "automatic")); k == KindNew {
				news <- struct{}{}
			}
		}(i)
	}
	wg.Wait()
	close(news)
	if n := len(news); n != 1 {
		t.Fatalf("same event from 2 sources under concurrency must yield exactly 1 new alert, got %d", n)
	}
}
