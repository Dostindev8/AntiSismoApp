# PROGRESS — AntiSismo

> Retomar con: `Continúa desde PROGRESS.md`. Gate reproducible: `make verify` (o `node scripts/verify.mjs`).

## Iteración 1 — 2026-09-29 · F0 + F1 completos · F2 parcial

✅ COMPLETADO:
- **F0 Fundamentos y marca** — monorepo (pnpm workspaces + `go.work` + Flutter `apps/mobile`), `.cursor/rules/antisismo.mdc`, `.env.example` (placeholders + IDs de blocker), `.gitignore` de secretos, `.gitattributes`, CI (`.github/workflows/ci.yml`: gate + `-race` + fuzz + gitleaks + govulncheck + pnpm audit), `infra/docker/docker-compose.yml` (Redis + PostGIS, solo 127.0.0.1).
- Tokens de diseño en **fuente única** `packages/config/tokens.json` → generados `app_tokens.g.dart` + `tokens.css` (Tailwind 4 `@theme`) con chequeo de drift.
- Test automático de contraste WCAG: 25 pares; **todos los ratios documentados en §4.1 confirmados (±0.01)** y prohibiciones §3#19 justificadas por test. Hallazgo: `accentBlue` sobre navy = 3.35:1 → solo para foco/selección (no texto); enlaces sobre oscuro usan `accentCyan`.
- Marca: escudo aislado por componente conexo, interior "vidrio" (alpha ~15 %) rellenado en blanco para fondos oscuros; `app_icon` 1024 opaco (iOS), adaptive icon (fg/bg/monochrome), splash nativo Android 12+, prueba 29 px. Fuentes Poppins 700/800 + Inter 400/500/600 **empaquetadas** (subset latino, 340 KB → 47 KB c/u) con licencias OFL.
- **F1 Contratos** — JSON Schemas (`NormalizedEvent`, `SignedAlert`, `ApiError`), validadores espejo **TS (zod) / Go / Dart** sobre los **mismos fixtures** (5 válidos, 17 inválidos) y 19 vectores Ed25519 (claves efímeras; privada nunca a disco) que cubren ALARM / INFORMATIVE / DRILL / RECONCILE. Errata §3#1 verificada en 3 lenguajes. Config por región DO/MX con schema e invariantes (MMI ≥ V para CRITICAL, poll ≥ 30 s, fuentes oficiales `disabled`). i18n es-DO + MX/AR/CL/ES/PE con tests de ortografía (§3#12), «Llegada estimada» (§3#11) y simulacro (§3#13), generado a Dart.
- **F2 (parcial)** — Go: normalizador + Haversine + dedup (menor score espacio-temporal, ΔM > 1.5 no fusiona), sanitización QA-16, UUIDv5 determinista, pipeline con revisiones (6.4 → 6.2) e idempotencia, poller USGS condicional (If-Modified-Since/ETag) con breaker, allowlist anti-SSRF (solo https + host fijo), backoff full-jitter. Fixtures **reales** de USGS grabados.
- App Flutter base: tema oscuro/claro desde tokens, `formatEventTime` (fecha larga + local + UTC 24 h), TEA en dispositivo con `clockOffset`, clasificador fail-safe de push, ledger de idempotencia, pantalla de bienvenida responsive.

🔄 EN PROGRESO: F2 — 70 %

⏳ SIGUIENTE (en orden):
1. F2: cliente WebSocket EMSC (ping, reconexión backoff+jitter, `insert/update`) + fixtures reales grabados; QA-20.
2. F2: registro de `AlertSourceProvider` por región desde YAML (Go lee `packages/config/regions`), métricas Prometheus (`source_health`, descartes), alarma ops fuente caída > 60 s.
3. F2: schema-diff en CI (TS zod ↔ JSON Schema ya probado; añadir comparación de claves requeridas Go/Dart vs schema).
4. F3: motor de decisión CRITICAL/INFORMATIVE + `IntensityEstimator` documentado + firma Ed25519 + cola con fallback a memoria + topics geohash + harness e2e p99 < 4 s.

⚠️ BLOQUEADOR: ver `BLOCKERS.md` (BLK-00 Blueprint/protocolos ausentes; BLK-08 sin Android SDK/Xcode/Docker en esta máquina ⇒ APK/IPA/compose no verificados).

🔐 SEGURIDAD:
- Firma asimétrica Ed25519 (nunca HMAC en cliente); firma inválida ⇒ RECONCILE (no alarma, confirma por TLS) — jamás silencia una alerta real.
- Simulacro firmado como `level=DRILL` (no se puede convertir en crítico sin romper la firma). Riesgo residual v1 y propuesta v2 en `docs/adr/0001-decisiones-f0-f2.md`.
- Texto de fuentes externas no confiable: sanitizado (control chars, `<>`, 200 UTF-16) y fuzzeado.
- Ingesta con allowlist https + host fijo (bloquea metadata 169.254.169.254, http, subdominios engañosos).
- Escaneo de secretos local en el gate + gitleaks en CI. `.env*` ignorados.
- Bug evitado: `applicationId` `do.antisismo.*` no compila (palabra reservada) → `app.antisismo.mobile`.

📈 MÉTRICAS (evidencia de esta iteración, `node scripts/verify.mjs`: **13/13 verde**):
- TS: 64 tests `@antisismo/config` + 51 tests `@antisismo/proto`, typecheck strict (TS 7.0.2).
- Go: cobertura normalize 100 % · pipeline 98.8 % · contract 87.6 % · resilience 80.8 % · usgs 78.9 %. Fuzz: ~1.8 M ejecuciones sin fallos.
- Flutter: 79 tests (contratos, tiempo, TEA, idempotencia, tokens, i18n, matriz responsive 7 tamaños × escala de texto 1.0/1.5/2.0 sin overflow); `flutter analyze` estricto: 0 issues.
- Latencia e2e: N/A hasta F3.

## Estado de gates
| Fase | Estado | Evidencia |
|---|---|---|
| F0 | ✅ verde (local) | gate 13/13; icono 29 px generado; contraste AA por test. CI definido pero **no ejecutado** (sin remoto) |
| F1 | ✅ verde | mismos fixtures en TS/Go/Dart; epoch↔texto en 3 lenguajes |
| F2 | 🔄 70 % | falta EMSC WS, registro por región, métricas/alarma ops |
| F3–F9 | ⏳ | — |

## Iteración 2 — 2026-09-30 · F2 + F3 + F5B completos · F5/F6 parcial

Detalle por fase y estado honesto en `docs/STATUS.md`; decisiones en `docs/adr/0002…0007`;
trazabilidad en `docs/TRACEABILITY.md`; benchmark en `docs/research/benchmark.md`.

✅ COMPLETADO: F2 residual (EMSC WS, regiones, salud/alarma) · F3 (decisión, firma, cola, FCM con
transporte simulado, e2e) · F5B emergencias (QA-E1…E6) · app: splash, shell 5 pestañas, alerta
pantalla completa con voz, perfil, guías, inglés · 13 capturas · APK debug.

Correcciones relevantes: `kid` del firmador real tras fallback (F3) · logo recoloreado eliminado (regla
de marca) · cabecera de alerta desbordaba a 320 px con texto 200 % · botones perdían la fuente Inter ·
pantallas abiertas por enlace sin «Volver» · texto que prometía comportamiento no verificado en
hardware · `.env.example` con codificación rota.

📈 MÉTRICAS (`node scripts/verify.mjs` + `flutter test`, esta iteración):
- Pruebas: Flutter 230 · Go 119 (proto 5, geo 5, ingestion 59, decision 13, delivery 37) · TS 125
  (config 74, proto 51) · scripts 6 ⇒ **480**, 0 fallos. `flutter analyze --fatal-infos`: 0 issues.
- Cobertura Go delivery: queue 89.8 % · transport 93.2 % · worker 92.3 % · dispatch 90.5 % · metrics 100 %.
- Latencia e2e (FCM simulado, 1 059 pushes críticos): p50 184 ms · p90 326 ms · p99 537 ms (SLO p99 < 4 s).
- APK debug: `apps/mobile/build/app/outputs/flutter-apk/app-debug.apk` (~172 MB, debug sin minificar).

⚠️ BLOQUEADORES nuevos: BLK-11 (911 MX fuente nacional), BLK-12 (capturas iOS), BLK-13 (keystore),
BLK-14 (flutter_tts KGP), BLK-15 (sin dispositivo/emulador).

| Fase | Estado | Evidencia |
|---|---|---|
| F2 | ✅ fuentes públicas | `emsc_test.go`, `regioncfg_test.go`, `health_test.go` |
| F3 | ✅ con FCM simulado | `e2e_test.go` p99 537 ms; real = BLK-01 |
| F4 | ⏳ | — |
| F5 | 🔶 | pantalla de alerta + TEA + voz; receptor push nativo pendiente |
| F5B | ✅ | QA-E1…E6, ADR-0002 |
| F6 | 🔶 | navegación/perfil/guías/en; Eventos/Mapa/Familia pendientes |
| F7–F8 | ⏳ | — |
| F9 | 🔶 | ver `docs/STATUS.md` |

## Web W3 — 2026-10-03 · Autenticación web contra el API real

Rama `feat/web-w3-auth` (sobre `feat/antisismo-v1`). Plan en `docs/WEB_PLAN.md`; decisiones en ADR 0008.

✅ COMPLETADO
- 9 pantallas: registro (medidor de fuerza, aceptación explícita y versionada de términos), verificar correo,
  login + MFA (TOTP o código de recuperación), recuperar y restablecer contraseña (revoca todas las sesiones),
  callback de Google, Mi cuenta (re-aceptación de términos), Seguridad (QR + clave manual + 10 códigos de
  recuperación, desactivar MFA) y Sesiones (cerrar una o todas las demás).
- Cliente same-origin `/api/v1` (reescritura `beforeFiles`; sin API ⇒ 503 `API_NOT_CONFIGURED` controlado),
  access token solo en memoria, refresh serializado con Web Locks + CSRF nuevo, BroadcastChannel entre pestañas.
- API: `GET /v1/auth/policy`, `POST /v1/me/sessions/revoke-others`, `POST /v1/me/terms`, términos versionados
  (`TERMS_OUTDATED`), límite de sesión separado del de login, servidor e2e (Mongo en memoria + buzón loopback),
  contratos zod compartidos `@antisismo/proto/account` validados contra respuestas reales.
- Guarda que no desmonta lo escrito al expirar la sesión; foco al primer error; `autocomplete`; noindex.
- i18n es-DO/en/fr/pt con las mismas claves y marcadores (test).

📈 MÉTRICAS (este turno)
- `node scripts/verify.mjs`: **GATE VERDE 29/29** (`docs/evidence/w3-gate.txt`).
- API vitest 58/58 · web vitest 57 · config 84.
- Playwright Chromium **12/12** contra API real (`docs/evidence/w3-e2e-chromium.txt`): flujo completo +
  anti-enumeración, redirección abierta (4 variantes), guarda, foco accesible, enlaces inválidos, sin conexión, noindex.
- axe (WCAG 2.2 AA): 0 serias/críticas en 9 estados de pantalla — **solo tema oscuro y viewport escritorio** (matriz completa en W7).

⚠️ BLOQUEADORES: BLK-23 (host del API), BLK-24 (aviso `braces` sin parche, solo desarrollo).

| Fase web | Estado | Evidencia |
|---|---|---|
| W0 auditoría | ✅ | `docs/WEB_PLAN.md`, `docs/evidence/w0-baseline-gate.txt` |
| W3 auth | ✅ local · CI pendiente del PR | `w3-gate.txt`, `w3-e2e-chromium.txt` |
| W4–W8 | ⏳ | — |
