package normalize

import (
	"strings"
	"testing"
	"unicode/utf8"

	"antisismo.app/proto/contract"
)

func FuzzSanitizePlace(f *testing.F) {
	for _, s := range []string{"", "<script>", "República Dominicana", "🌎🌎", "\x00\x1f\x7f", strings.Repeat("é", 300)} {
		f.Add(s)
	}
	f.Fuzz(func(t *testing.T, s string) {
		out := SanitizePlace(s)
		if !utf8.ValidString(out) || contract.UTF16Len(out) > contract.MaxPlaceUnits || strings.ContainsAny(out, "<>") {
			t.Fatalf("unsafe sanitize output for %q: %q", s, out)
		}
		e := contract.Event{ID: EventID("usgs", "fz"), SourceIDs: map[string]string{"usgs": "fz"}, Type: "EARTHQUAKE",
			MagType: "Mw", TimeUTCms: 1790627527000, ReceivedAtMs: 1790627527000, SolutionStatus: "automatic", Place: out}
		if err := e.Validate(); err != nil {
			t.Fatalf("sanitized place must always pass contract: %q → %v", out, err)
		}
	})
}

func FuzzDecodeEvent(f *testing.F) {
	f.Add([]byte(`{"id":"3f6c2a1e-8b4d-4c1a-9e2f-7a5b6c8d9e01"}`))
	f.Add([]byte(`not json`))
	f.Add([]byte(`{"lat":1e400}`))
	f.Fuzz(func(t *testing.T, b []byte) {
		e, err := contract.DecodeEvent(b)
		if err == nil && e.Validate() != nil {
			t.Fatal("DecodeEvent returned an invalid event")
		}
	})
}
