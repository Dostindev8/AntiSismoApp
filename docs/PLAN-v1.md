# Plan v1 — Plataforma web AntiSismo (Fase 0 · 2026-09-30)

## 1. Qué existe (verificado hoy)
| Área | Estado | Evidencia |
|---|---|---|
| Repo git | `main` = `origin/main` (1 commit `c1abb52`), `gh` autenticado como Dostindev8 | `git status`, `gh auth status` |
| Camino crítico de alertas (Go) | Ingesta USGS+EMSC → decisión por celda → firma Ed25519 → cola Redis/memoria → FCM (simulado) | gate 23/23, p99 537 ms |
| App móvil (Flutter) | Splash, 5 pestañas, alerta, emergencias F5B, ficha cifrada, es-DO/en; build web local | 230 tests, APK debug |
| Contratos/tokens/i18n | `packages/proto`, `packages/config` (fuente única) | 125 tests TS |
| Reservado sin construir | `apps/web`, `services/api` (ya listados en `pnpm-workspace.yaml`) | carpetas inexistentes |
| CI | `.github/workflows/ci.yml` — acciones por **tag, no por SHA** (hallazgo) | lectura del archivo |
| Herramientas locales | Node 22.23 (LTS vigente = **24.21 «Krypton»**), pnpm 9.15, Go 1.27, Flutter 3.47, gitleaks 8.30, gh 2.101. **Sin Docker** ⇒ Trivy/ZAP/Mongo en contenedor solo en CI | `--version` |

## 2. Fuentes de datos (respuesta en vivo hoy)
| Fuente | Estado | Uso |
|---|---|---|
| USGS GeoJSON | 200 JSON | sismos (ya integrado en Go) |
| EMSC FDSN/WS | 200 JSON | sismos (ya integrado) |
| tsunami.gov PHEB (Caribe) / PAAQ Atom | 200 XML | tsunami: avisos oficiales, solo lectura y enlace |
| Open-Meteo | 200 JSON | clima/lluvia (verificar términos de uso comercial) |
| SGN, ONAMET, COE, Defensa Civil | 200 HTML, **sin API documentada** | solo enlaces oficiales; scraping no (BLK-04) |
| tile.openstreetmap.org | 200 | **no apto para producción** (política de uso); necesita proveedor de teselas |

## 3. Versiones vigentes (registro npm, hoy)
next 16.3.8 · react 19.3.0 · express 5.2.1 · mongoose 9.10.3 · zod 4.6.5 · next-intl 4.14.8 ·
maplibre-gl 6.11.2 · argon2 0.45.1 · helmet 8.3.0 · pino 10.3.1 · jose 6.2.12 · ioredis 6.0.0 ·
web-push 3.6.7 · @serwist/next 9.5.12 · @tanstack/react-query 5.104.0 · tailwindcss 4.3.3 ·
vitest 5.0.3 · @playwright/test 1.63.0. (CVE/licencia se revisan al instalar con `pnpm audit` + osv.)

## 4. Arquitectura propuesta (extender, no reemplazar)
```
Fuentes ──► services/ingestion (Go) ──► decision (Go) ──► delivery (Go) ──► FCM / Web Push
                                              │ eventos normalizados (Redis Stream)
                                              ▼
apps/web (Next.js PWA) ◄──► services/api (Express+TS) ──► MongoDB (cuentas, familia, sitios, org)
                                   └─► Redis (caché, rate limit; fallback memoria)
```
- **El camino crítico sigue en Go y no depende de Mongo ni de la API** (regla 2 del repo).
- `services/api` = todo lo «no crítico»: cuentas, familia, sitios seguros, empresa, preferencias, SSE de eventos.
- **Recibir alertas públicas nunca exige cuenta** (regla vigente); login es opcional.
- Tokens/i18n siguen saliendo de `packages/config` (se añade salida para web y fr/pt).

## 5. Conflictos detectados entre el prompt nuevo y reglas vigentes
1. **Cuenta regresiva**: el prompt pide mostrarla solo si la fuente oficial la da; la app móvil hoy calcula
   una estimación local etiquetada. Ninguna fuente pública integrada provee tiempo de llegada.
2. **Logo SVG**: el prompt pide recrearlo en vector; la regla de marca prohíbe distorsionar/recolorear.
   Un trazado manual nunca es idéntico al original.
3. **Paleta**: el prompt trae colores distintos a `tokens.json` (p. ej. `#061633` vs `#0A2540`).
4. **Volcanes en RD**: se presentará como módulo regional, sin alarmismo.

## 6. Fases y compuertas (cada una: lint + typecheck + tests + build + gitleaks en verde)
| Fase | Entrega | Estimación honesta |
|---|---|---|
| 1 Fundamentos | `apps/web` Next+Tailwind+next-intl (es-DO/en/fr/pt), tokens, PWA, CI con SHA | 1 sesión |
| 2 Seguridad base | `services/api`: Argon2id, JWT EdDSA + refresh rotativo, RBAC, helmet/CSP, rate limit, auditoría | 1–2 sesiones |
| 3 Datos | modelos Mongo 2dsphere, proveedores USGS/EMSC/PTWC, SSE, Web Push VAPID | 1–2 sesiones |
| 4 Interfaz | 16 pantallas del §4.2, responsive, estados, a11y | 2–3 sesiones |
| 5 Críticas | SOS, Mi Familia, plan PDF, panel Empresa | 1–2 sesiones |
| 6 Pruebas/auditoría | Vitest, Supertest + mongodb-memory-server, Playwright, axe, Lighthouse, CodeQL, ZAP en CI | 1–2 sesiones |
| 7–8 Docs y publicación | README, SECURITY, threat model, audit report, rama `feat/antisismo-v1`, PR, tag rc | 1 sesión |

**No se puede entregar todo con calidad en un solo turno**; se trabaja por fases con commits atómicos.

## 7. Lo que requiere al propietario (no se inventa)
Cliente OAuth de Google · MongoDB (Atlas o local) · proveedor de teselas (MapTiler u otro) · dominio ·
licencia del repo · revisión legal (Ley 172-13) · datos oficiales de refugios/hospitales (COE/MSP) ·
claves VAPID de producción (se generan localmente, nunca en git).

## 8. Riesgos principales
| Riesgo | Mitigación |
|---|---|
| Datos de refugios no oficiales | Solo seeds `DEMO` rotulados; nunca «Seguro» sin `verified=true` |
| Confundir demo con alerta real | Modo demo desactivado en producción por config + rótulo permanente |
| Sin Docker local | ZAP/Trivy/Mongo-contenedor en GitHub Actions; local usa mongodb-memory-server |
| Alcance enorme | Fases con compuerta; PR por fase |
