module antisismo.app/delivery

go 1.26.0

require (
	antisismo.app/decision v0.0.0
	antisismo.app/geo v0.0.0
	antisismo.app/ingestion v0.0.0
	antisismo.app/proto v0.0.0
	github.com/redis/go-redis/v9 v9.22.0
	golang.org/x/oauth2 v0.37.0
)

require (
	cloud.google.com/go/compute/metadata v0.3.0 // indirect
	github.com/alicebob/miniredis/v2 v2.39.0 // indirect
	github.com/cespare/xxhash/v2 v2.3.0 // indirect
	github.com/coder/websocket v1.8.15 // indirect
	github.com/yuin/gopher-lua v1.1.1 // indirect
	go.uber.org/atomic v1.11.0 // indirect
	go.yaml.in/yaml/v3 v3.0.5 // indirect
	golang.org/x/sys v0.30.0 // indirect
)

replace (
	antisismo.app/decision => ../decision
	antisismo.app/geo => ../../packages/geo/go
	antisismo.app/ingestion => ../ingestion
	antisismo.app/proto => ../../packages/proto/go
)
