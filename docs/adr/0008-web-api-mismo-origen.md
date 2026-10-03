# ADR 0008 — Web ↔ API por el mismo origen, EdDSA y hosting del API

- Estado: aceptado (2026-10-03)
- Contexto: fases web W3–W8.

## Decisión

1. **Proxy de mismo origen.** La web reescribe `/api/v1/:path*` hacia `API_INTERNAL_ORIGIN/v1/:path*` (variable de servidor). El navegador nunca ve el host del API.
   - Las cookies de refresh y CSRF quedan como cookies de primer nivel de la web (`__Host-`, `Secure`, `HttpOnly`, `SameSite=Strict`).
   - No se necesita CORS con credenciales; la guarda de `Origin` del API sigue activa (`API_CORS_ORIGINS` = origen de la web).
   - `API_PUBLIC_ORIGIN` = `https://<web>/api` para que el callback de Google vuelva por el mismo origen.
2. **JWT EdDSA (Ed25519), no RS256.** El prompt W3 pide RS256; el API ya firma con Ed25519 (claves más cortas, firma determinista, sin riesgo de padding), con JWKS publicado y pruebas. Cambiarlo sería reescribir algo verde sin ganancia de seguridad.
3. **Next 16.3.8, no 15.** Es la versión ya fijada y probada en el repo.
4. **Hosting del API: contenedor, no serverless.** SSE y conexiones largas no encajan en funciones de Vercel. El API (y los servicios Go) van a un host de contenedores (Fly.io, Railway, Render o Cloud Run). Mientras no exista (BLK-23) la web se despliega en Vercel con el API apuntando a un entorno de preview rotulado.
5. **Access token solo en memoria** y refresh serializado con `navigator.locks` + CSRF nuevo por intento (corrige el riesgo residual de varias pestañas).
6. **Sin API configurado, degradación explícita.** Si `API_INTERNAL_ORIGIN` está vacío no hay reescritura y `/api/v1/*` responde 503 `API_NOT_CONFIGURED` (ruta de respaldo); la UI lo muestra sin romper el resto del sitio. La reescritura usa `beforeFiles` para ganar a esa ruta cuando sí hay API.
7. **Política pública `GET /v1/auth/policy`.** Versión de términos, límites de contraseña y disponibilidad de Google salen del API (una sola fuente); la web no fija ninguno.
8. **IP real del cliente.** Detrás de la web (y del balanceador del host) `API_TRUST_PROXY` debe contar los saltos reales; si no, el rate limit por IP agruparía a todos los usuarios bajo la IP del proxy.
9. **Límite propio para sesión.** `csrf`/`refresh`/`logout` usan `API_RATE_SESSION_MAX` (por defecto 300/ventana) y no consumen el cupo de login; la web solo restaura sesión si existe la pista booleana `antisismo.has-session` (nunca un token).

## Consecuencias

- Una sola superficie pública (la web) y cabeceras de seguridad uniformes.
- La latencia añade un salto web → API; aceptable porque el camino crítico de alertas no pasa por aquí (las alertas públicas no requieren cuenta).
- Si el API cae, la web sigue sirviendo la información de emergencia estática.
