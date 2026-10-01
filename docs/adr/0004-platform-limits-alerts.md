# ADR-0004 — Límites de plataforma para alertas · 2026-09-30

## Hechos
- **iOS**: un sonido que atraviese el modo silencio/No molestar requiere el entitlement *Critical Alerts*
  aprobado por Apple (BLK-02). Sin él, la notificación llega pero respeta el silencio.
- **Android**: la pantalla completa con teléfono bloqueado requiere `USE_FULL_SCREEN_INTENT`
  (restringido en Android 14+ a apps de alarma/llamada; Play exige declaración) y canal de notificación
  de importancia alta. FCM HTTP v1 con prioridad alta (BLK-01).
- **Entrega**: FCM/APNs no garantizan latencia; por eso el TEA se recalcula en el dispositivo con el
  offset de reloj del servidor y se etiqueta «Estimación, no medición oficial».

## Decisión
- Hoy la app implementa la **pantalla de alerta** (abierta por ruta/simulacro) y la clasificación
  segura del payload. El receptor de push nativo, el canal de notificación y el full-screen intent se
  integran cuando existan credenciales (BLK-01/BLK-02) y dispositivo de prueba (BLK-15).
- Fail-safe: si la voz (TTS) falla, la pantalla se muestra igual; si la firma falla, se reconcilia por TLS.
- La app nunca afirma «sonará aunque esté en silencio» en iOS hasta que el entitlement esté aprobado.

## Riesgo mitigado
El texto `alerts.noneBody` prometía que la pantalla «se abriría sola con sonido con el teléfono
bloqueado», comportamiento no verificado en hardware (BLK-01/02/15). Se reemplazó por un texto que no
promete más de lo implementado. Se restaurará la promesa solo con evidencia en dispositivo.
