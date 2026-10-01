module antisismo.app/decision

go 1.23

require (
	antisismo.app/geo v0.0.0
	antisismo.app/proto v0.0.0
)

replace (
	antisismo.app/geo => ../../packages/geo/go
	antisismo.app/proto => ../../packages/proto/go
)
