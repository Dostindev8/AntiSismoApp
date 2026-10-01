package usgs

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"antisismo.app/ingestion/resilience"
)

func TestParseRecordedRealFeeds(t *testing.T) {
	for _, name := range []string{"testdata/significant_week.geojson", "testdata/all_hour.geojson"} {
		b, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		var st Stats
		obs, err := Parse(b, time.Now().UnixMilli(), &st)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if len(obs) == 0 {
			t.Fatalf("%s: no observations parsed", name)
		}
		for _, o := range obs {
			if err := o.Event.Validate(); err != nil {
				t.Errorf("%s: %s invalid: %v", name, o.SourceID, err)
			}
			if o.Event.TimeUTCms < 1_000_000_000_000 {
				t.Errorf("%s: time looks like seconds", o.SourceID)
			}
		}
	}
}

func TestParseRealValuesMapping(t *testing.T) {
	b, _ := os.ReadFile("testdata/significant_week.geojson")
	var st Stats
	obs, _ := Parse(b, 1790735595000, &st)
	var found bool
	for _, o := range obs {
		if o.SourceID == "us6000txpi" {
			found = true
			e := o.Event
			if e.Magnitude != 6.6 || e.Lon != 168.61 || e.Lat != -21.2982 || e.DepthKm != 10 || e.SolutionStatus != "reviewed" || e.MagType != "mww" {
				t.Fatalf("mapping mismatch: %+v", e)
			}
		}
	}
	if !found {
		t.Fatal("us6000txpi not parsed")
	}
}

func TestParseDiscardsMalformedWithoutFailingBatchQA21(t *testing.T) {
	body := `{"features":[
	 {"id":"ok1","properties":{"mag":5.1,"place":"<b>RD</b>","time":1790627527000,"updated":1790627530000,"status":"automatic","tsunami":0,"magType":"mb","type":"earthquake"},"geometry":{"type":"Point","coordinates":[-69.9,19.7,10]}},
	 {"id":"nomag","properties":{"mag":null,"time":1790627527000,"type":"earthquake"},"geometry":{"type":"Point","coordinates":[-69.9,19.7,10]}},
	 {"id":"secs","properties":{"mag":5,"time":1790627527,"type":"earthquake"},"geometry":{"type":"Point","coordinates":[-69.9,19.7,10]}},
	 {"id":"swap","properties":{"mag":5,"time":1790627527000,"type":"earthquake"},"geometry":{"type":"Point","coordinates":[19.7,-99.1,10]}},
	 {"id":"blast","properties":{"mag":2,"time":1790627527000,"type":"quarry blast"},"geometry":{"type":"Point","coordinates":[-69.9,19.7,0]}},
	 {"id":"del","properties":{"mag":5,"time":1790627527000,"status":"deleted","type":"earthquake"},"geometry":{"type":"Point","coordinates":[-69.9,19.7,10]}},
	 {"id":"short","properties":{"mag":5,"time":1790627527000,"type":"earthquake"},"geometry":{"type":"Point","coordinates":[-69.9]}},
	 "garbage"
	]}`
	var st Stats
	obs, err := Parse([]byte(body), 1790627530000, &st)
	if err != nil {
		t.Fatal(err)
	}
	if len(obs) != 1 || obs[0].SourceID != "ok1" || strings.ContainsAny(obs[0].Event.Place, "<>") {
		t.Fatalf("unexpected result: %+v", obs)
	}
	if st.Rejected.Load() != 5 || st.Skipped.Load() != 2 {
		t.Fatalf("stats rejected=%d skipped=%d", st.Rejected.Load(), st.Skipped.Load())
	}
	if _, err := Parse([]byte("{not json"), 0, &st); err == nil {
		t.Fatal("undecodable feed must error")
	}
}

func TestPollerConditionalRequestsAndBreaker(t *testing.T) {
	body, _ := os.ReadFile("testdata/significant_week.geojson")
	const lm = "Wed, 30 Sep 2026 02:33:15 GMT"
	calls, fail := 0, false
	ts := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if fail {
			http.Error(w, "down", http.StatusServiceUnavailable)
			return
		}
		if r.Header.Get("If-Modified-Since") == lm {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("Last-Modified", lm)
		_, _ = w.Write(body)
	}))
	defer ts.Close()

	client := &http.Client{Timeout: 2 * time.Second, Transport: &resilience.AllowlistTransport{
		Allowed: map[string]bool{"127.0.0.1": true}, Next: ts.Client().Transport,
	}}
	p := NewPoller(ts.URL+"/feed", 30*time.Second, client)
	ctx := context.Background()

	obs, nm, err := p.Fetch(ctx)
	if err != nil || nm || len(obs) != 2 {
		t.Fatalf("first fetch: n=%d nm=%v err=%v", len(obs), nm, err)
	}
	if _, nm, err = p.Fetch(ctx); err != nil || !nm {
		t.Fatalf("second fetch must be 304, nm=%v err=%v", nm, err)
	}
	fail = true
	for i := 0; i < 5; i++ {
		_, _, _ = p.Fetch(ctx)
	}
	before := calls
	if _, _, err := p.Fetch(ctx); err != resilience.ErrOpen || calls != before {
		t.Fatalf("breaker must open after 5 failures and stop calling the source (err=%v)", err)
	}
}

func TestPollerRejectsNonAllowlistedHost(t *testing.T) {
	p := NewPoller("https://attacker.example/feed", time.Second, resilience.NewHTTPClient([]string{"earthquake.usgs.gov"}, time.Second))
	if _, _, err := p.Fetch(context.Background()); err == nil || !strings.Contains(err.Error(), "allowlist") {
		t.Fatalf("expected allowlist error, got %v", err)
	}
}
