# ADR-0003 — Firma de alertas Ed25519 · 2026-09-30

## Decisión
- Cada push crítico lleva `SignedAlert v1` firmado con **Ed25519** sobre la cadena canónica
  `v1\nalert_id\nevent_id\nrevision_seq\ntime_utc_ms\niat_ms\nexp_ms\nlevel\ninstruction`.
- `alert_id = sha256(event.id:revision_seq)` ⇒ idempotente por evento+revisión.
- `kid` **no** forma parte de la cadena; se asigna **después** de firmar con el firmador que realmente
  firmó (bug corregido en F3: con firmador de respaldo se publicaba el `kid` primario).
- Firmador principal + respaldo (`FallbackSigner`); si ambos fallan se envía un push de reconciliación
  (el dispositivo consulta por TLS) — nunca se suprime la alerta.
- Cliente: firma inválida, `kid` desconocido, `alert_id` no coincidente o ventana > 10 min ⇒ `RECONCILE`
  (no alarma; confirma por TLS). Simulacro = `level=DRILL` dentro de la firma (ADR-0001 §2).
- Claves: producción en KMS/HSM (BLK-03). `alertd` se niega a arrancar fuera de `ANTISISMO_ENV=dev`
  sin `SIGNING_SEED_B64`. En dev usa clave efímera y lo registra como advertencia.

## Evidencia
19 vectores compartidos TS/Go/Dart (`packages/proto/fixtures/alert-vectors.json`); `dispatch_test.go`
(backup kid, reconcile si fallan todos); `alert_test.dart` construye la vista desde el vector `valid-critical`.
