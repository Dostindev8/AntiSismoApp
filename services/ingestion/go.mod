module antisismo.app/ingestion

go 1.23

require (
	antisismo.app/proto v0.0.0
	github.com/coder/websocket v1.8.15
	go.yaml.in/yaml/v3 v3.0.5
)

replace antisismo.app/proto => ../../packages/proto/go
