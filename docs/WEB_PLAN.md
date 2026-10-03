# Plan web W3–W8 (Paso 0 · 2026-10-03)

> Las fases web se llaman **W3–W8** para no chocar con F0–F9 de `PROGRESS.md` (móvil + servicios Go).

## 1. Inventario verificado

| Área | Estado real | Evidencia |
|---|---|---|
| `apps/web` | Next 16.3.8 + React 19.3 + TS estricto + Tailwind 4 (`tokens.css` generado) + next-intl (es-DO/en/fr/pt), CSP con nonce (`proxy.ts`), cabeceras estáticas, landing, 404, error, tarjeta 911 verificada | `apps/web/src/**` |
| `services/api` | Express 5 + Mongo: registro, verificación, login, MFA TOTP + recuperación, refresh rotativo con detección de reutilización, logout, olvido/restablecimiento, Google PKCE, `/v1/me` (perfil, sesiones, MFA), admin (auditoría, roles), OpenAPI | 54 pruebas, PR #1 en verde |
| Camino crítico Go | ingesta USGS/EMSC → decisión → firma Ed25519 → cola Redis/memoria → FCM (simulado) | `go test -race` en CI |
| Contratos | `packages/proto` (JSON Schema + zod + vectores Ed25519) | fixtures compartidos TS/Go/Dart |
| Vercel | **sin proyecto enlazado** (no hay `.vercel/` ni `vercel.json`) | `Get-ChildItem` |
| GitHub | `origin` = `Dostindev8/AntiSismoApp` (público), `gh` autenticado; rama `feat/antisismo-v1` = PR #1 | `gh auth status` |

Versiones: el prompt pide Next 15 y JWT RS256; el repo ya usa **Next 16.3.8** y **JWT EdDSA (Ed25519)**, probados en CI. Se conservan (extender, no reemplazar); ver ADR 0008.

## 2. Las 16 pantallas (rutas reales)

| # | Pantalla | Ruta | Fase |
|---|---|---|---|
| 1 | Registro | `/auth/register` | W3 |
| 2 | Verificación de correo | `/auth/verify` (enlace `#token=`) | W3 |
| 3 | Inicio de sesión | `/auth/login` | W3 |
| 4 | MFA (desafío en login + activación + códigos) | `/auth/login` (paso 2) · `/account/security` | W3 |
| 5 | Recuperar contraseña | `/auth/forgot` | W3 |
| 6 | Restablecer contraseña | `/auth/reset` (enlace `#token=`) | W3 |
| 7 | Sesiones y dispositivos | `/account/sessions` | W3 |
| 8 | Alertas en vivo (feed + detalle) | `/alerts`, `/alerts/[id]` | W4 |
| 9 | Mapa | `/map` | W4 |
| 10 | SOS | `/sos` | W5 |
| 11 | Mi Familia | `/family` | W5 |
| 12 | Plan de emergencia | `/plan` | W5 |
| 13 | Panel de empresa | `/org` | W6 |
| 14 | Términos | `/legal/terms` | W6 |
| 15 | Privacidad | `/legal/privacy` | W6 |
| 16 | Cookies / avisos | `/legal/cookies` | W6 |

Además: `/` (landing), `/account` (resumen), `/auth/callback` (Google), 404 y error.

## 3. Arquitectura de la web contra el API

- **Mismo origen:** el navegador solo habla con la web; Next reescribe `/api/v1/*` → `API_INTERNAL_ORIGIN/v1/*` (variable de servidor, nunca en el bundle). Las cookies de refresh/CSRF quedan en el dominio de la web (`__Host-`, `SameSite=Strict`) y no hace falta CORS con credenciales.
- **Access token solo en memoria**; nunca `localStorage`. Al recargar: `GET /csrf` + `POST /refresh`.
- **Varias pestañas:** el refresh va dentro de un `navigator.locks` exclusivo y pide CSRF nuevo en cada intento, así dos pestañas no reutilizan el mismo refresh (antes eso se detectaba como robo y cerraba la sesión).

## 4. Orden y riesgos

1. W3 auth (API ya existe; faltan «cerrar otras sesiones» y aceptación de términos versionada).
2. W4 tiempo real: el API aún no tiene SSE ni Web Push → se añaden en `services/api` leyendo el stream de eventos (Redis, con memoria de respaldo); el camino crítico Go no cambia.
3. W5–W6: modelos nuevos en Mongo (familia, plan, organización) con pruebas IDOR.
4. W7–W8: Playwright multinavegador, axe, Lighthouse, Trivy/ZAP en CI, documentación, Vercel.

| Riesgo | Mitigación |
|---|---|
| El API no puede ir a producción (BLK-21: sin correo real) | La web se despliega con API de preview rotulado; no se finge producción |
| SSE de larga duración no encaja en serverless | El API corre en contenedor (ADR 0008, BLK-23) |
| Mapa sin proveedor de teselas (BLK-17) | Lista accesible como vista principal; mapa con teselas de desarrollo rotuladas |
| Textos legales sin revisión (BLK-10/20) | Versionados y marcados como borrador en docs, no en la UI de emergencia |
