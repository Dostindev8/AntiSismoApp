# ADR-0007 — Observabilidad del camino crítico · 2026-09-30

## Decisión
Métricas en formato de exposición Prometheus, sin dependencias, en `127.0.0.1` por defecto
(`METRICS_ADDR`). Sin PII ni payloads en logs (probado: `delivery_dlq` no filtra el cuerpo).

| Métrica | Tipo | Uso |
|---|---|---|
| `antisismo_source_up{source,primary}` | gauge | fuente respondiendo |
| `antisismo_source_down_alarm` / `_down_alarms_total` | gauge / counter | alarma ops si una fuente primaria cae > umbral (60 s) |
| `antisismo_source_latency_ms`, `_last_success_ms`, `_last_event_ms` | gauge | salud de ingesta |
| `antisismo_source_failures_total`, `_events_total` | counter | errores / observaciones |
| `antisismo_latency_e2e_ms{quantile}` | summary | evento recibido → aceptado por el proveedor push |
| `antisismo_queue_to_send_ms{quantile}` | summary | encolado → aceptado |
| `antisismo_delivery_total{result}`, `_retries_total`, `_dlq_total` | counter | entrega |
| `antisismo_signature_failures_total` | counter | fallos de firma (se reconcilia) |
| `antisismo_queue_degraded` | gauge | Redis caído ⇒ cola en memoria |
| `antisismo_push_transport_ready` | gauge | credenciales FCM presentes |

`GET /healthz` devuelve JSON con `degraded` (sin Redis o sin FCM ⇒ degradado, sigue aceptando alertas).

## SLO de diseño (medido con harness e2e, FCM simulado)
p50 < 2 s, p99 < 4 s evento→proveedor push. Medido en F3: p50 184 ms, p99 537 ms (1 059 pushes críticos).
Producción requiere exportador OTel/Sentry (BLK-06) y alertas sobre `source_down_alarm`,
`queue_degraded`, `push_transport_ready == 0` y `dlq_total` creciente.
