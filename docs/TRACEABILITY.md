# Trazabilidad requisito → código → prueba (2026-09-30)

Los IDs RF/RNF del Blueprint no se pueden trazar mientras falte el PDF (BLK-00). Se trazan los
requisitos de `docs/EXECUTION_PROMPT.md` y del prompt maestro con IDs QA-*/E-*.

| Requisito | Código | Prueba (evidencia automatizada) |
|---|---|---|
| Contrato único TS/Go/Dart (eventos, alertas, errores) | `packages/proto/schemas`, `packages/proto/go/contract`, `apps/mobile/lib/core/contract/contract.dart` | fixtures compartidos: `packages/proto` (51), `contract_test.go`, `test/contract_test.dart` |
| alert_id determinista (evento+revisión) | `packages/proto/src`, `packages/proto/go/contract`, `lib/core/contract/contract.dart` | 19 vectores Ed25519 en 3 lenguajes |
| Firma Ed25519, inválida ⇒ RECONCILE | `services/delivery/dispatch`, `lib/core/contract/contract.dart` (`AlertAction`) | `dispatch_test.go`, `test/contract_test.dart` (ADR-0003) |
| Simulacro firmado (DRILL) | `packages/proto/go/contract`, `lib/features/alert/domain/alert_view.dart` | vectores `drill-*`, `test/alert/alert_test.dart` |
| Ingesta USGS (condicional + breaker + allowlist) | `services/ingestion/sources/usgs`, `resilience` | `usgs_test.go`, `resilience_test.go`, fuzz |
| Ingesta EMSC WebSocket (ping, reconexión jitter) — QA-20 | `services/ingestion/sources/emsc` | `emsc_test.go` (fixtures reales) |
| Fuentes por región desde YAML | `services/ingestion/regioncfg`, `runner` | `regioncfg_test.go`, `runner_test.go` |
| Alarma ops fuente caída > 60 s | `services/ingestion/health` | `health_test.go` |
| Dedup/normalización/sanitización QA-16 | `services/ingestion/normalize`, `pipeline` | `normalize_test.go`, `pipeline_test.go`, fuzz |
| Decisión CRITICAL/INFORMATIVE por celda | `services/decision/engine`, `ipe` | `engine_test.go`, `ipe_test.go` |
| Topics geohash gruesos (privacidad) | `services/decision/engine` | `engine_test.go` (precisión 3..5) — ADR-0006 |
| Cola Redis Streams + fallback memoria + DLQ | `services/delivery/queue`, `worker` | `queue_test.go` (89.8 %), `worker_test.go` (92.3 %) |
| FCM HTTP v1 con timeout/retry/breaker | `services/delivery/transport` | `transport_test.go` (93.2 %) — real pendiente BLK-01 |
| e2e p99 < 4 s | `services/delivery/e2e` | p50 184 ms / p99 537 ms (FCM simulado) |
| Métricas / healthz | `services/delivery/metrics`, `cmd/alertd` | `metrics_test.go` (100 %) — ADR-0007 |
| TEA en dispositivo con offset de reloj | `lib/core/geo/arrival.dart`, `alert_view.dart` | `test/core_test.dart`, `alert_test.dart` (12 s sin ubicación, 8 s epicentro) |
| Pantalla de alerta: voz exacta + nombre + llegada | `lib/features/alert/ui/alert_screen.dart` | `alert_test.dart`, `core_test.dart` (plantilla literal es-DO) |
| Estoy bien / Necesito ayuda / Llamar | `alert_screen.dart` | `alert_test.dart` |
| QA-E1 sanitización de números | `lib/features/emergency/domain/phone_number.dart` | `test/emergency/phone_number_test.dart` |
| QA-E2 contactos verificados, sin drift | `data/emergency_contacts`, `scripts/lib/emergency-contacts.mjs` | `contacts_test.dart`, `emergency-contacts.test.mjs` |
| QA-E3 mantener para llamar / cancelar | `lib/features/emergency/ui/hold_to_call_button.dart` | `hold_to_call_test.dart` |
| QA-E4 offline (sin red ni backend) | `emergency_contacts.g.dart`, `emergency_screen.dart` | `emergency_screen_test.dart` |
| QA-E5 sin telefonía | `emergency_screen.dart` | `emergency_screen_test.dart`, captura 11 |
| QA-E6 nunca número real en pruebas | `resolveDialTarget`, `dialTargetProvider` | `emergency_screen_test.dart` (FakeDialer, 5550100) |
| Ubicación Plus Code + SMS que envía la persona | `lib/core/geo/plus_code.dart`, `emergency_screen.dart` | `plus_code_test.dart`, `emergency_screen_test.dart` |
| Ficha de emergencia cifrada + FLAG_SECURE | `lib/features/emergency/data/medical_card.dart` (`MedicalCardVault`), `medical_card_screen.dart`, `MainActivity.kt` | `medical_card_test.dart` |
| Navegación 5 pestañas + perfil + emergencia | `lib/app/router.dart`, `shell.dart` | `test/app/navigation_test.dart` |
| Splash con reducir movimiento | `lib/features/onboarding/splash_screen.dart` | `navigation_test.dart` |
| Logo sin recolorear, contain, 25 % margen | `lib/app/widgets/brand_logo.dart`, `scripts/brand` | `navigation_test.dart`, `verify.mjs` (assets) — ADR-0005 |
| i18n es-DO + en, sin claves faltantes | `packages/config/i18n`, `messages.g.dart` | `i18n.test.ts`, `test/i18n_keys_test.dart` |
| WCAG AA contraste | `packages/config/tokens.json` | `tokens.test.ts` (pares) |
| Responsive 320 px → escritorio, texto 200 % | todas las pantallas | matrices en `navigation_test`, `alert_test`, `emergency_screen_test`, `welcome_responsive_test` |
| Sin secretos | `.gitignore`, `.env.example` | `verify.mjs` (escaneo de secretos) |

## No trazable todavía (no construido)
F4 API REST + PostGIS · F7 mapas MapLibre · F8 familia/panel admin web · F9 hardening completo
(pinning, App Check, pentest) · receptor push nativo en el móvil (BLK-01).
