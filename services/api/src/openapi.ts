type Op = { summary: string; auth?: "bearer" | "cookie+csrf"; roles?: string; status: string };

const ops: Record<string, Record<string, Op>> = {
  "/healthz": { get: { summary: "Liveness", status: "200" } },
  "/readyz": { get: { summary: "Readiness (MongoDB obligatorio; Redis degradable)", status: "200" } },
  "/.well-known/jwks.json": { get: { summary: "Claves públicas EdDSA de los access tokens", status: "200" } },
  "/v1/auth/register": { post: { summary: "Registro (respuesta idéntica exista o no la cuenta)", status: "202" } },
  "/v1/auth/verify-email": { post: { summary: "Confirma correo con token de un solo uso", status: "200" } },
  "/v1/auth/verify-email/resend": { post: { summary: "Reenvía verificación (anti-enumeración)", status: "202" } },
  "/v1/auth/login": { post: { summary: "Login con contraseña; puede exigir MFA", status: "200" } },
  "/v1/auth/login/mfa": { post: { summary: "Completa login con TOTP o código de recuperación", status: "200" } },
  "/v1/auth/refresh": { post: { summary: "Rota refresh token (detección de reutilización)", auth: "cookie+csrf", status: "200" } },
  "/v1/auth/logout": { post: { summary: "Revoca la sesión actual", auth: "cookie+csrf", status: "204" } },
  "/v1/auth/password/forgot": { post: { summary: "Solicita restablecimiento (anti-enumeración)", status: "202" } },
  "/v1/auth/password/reset": { post: { summary: "Restablece contraseña y revoca todas las sesiones", status: "200" } },
  "/v1/auth/google/start": { get: { summary: "Inicia OAuth 2.0 + PKCE con Google", status: "302" } },
  "/v1/auth/google/callback": { get: { summary: "Callback OAuth (state + nonce + PKCE)", status: "302" } },
  "/v1/me": {
    get: { summary: "Perfil propio", auth: "bearer", status: "200" },
    patch: { summary: "Actualiza perfil (teléfono cifrado AES-256-GCM)", auth: "bearer", status: "200" },
  },
  "/v1/me/sessions": { get: { summary: "Sesiones activas propias", auth: "bearer", status: "200" } },
  "/v1/me/sessions/{id}": { delete: { summary: "Revoca una sesión propia", auth: "bearer", status: "204" } },
  "/v1/me/mfa/setup": { post: { summary: "Genera secreto TOTP pendiente", auth: "bearer", status: "200" } },
  "/v1/me/mfa/enable": { post: { summary: "Activa TOTP y entrega códigos de recuperación", auth: "bearer", status: "200" } },
  "/v1/me/mfa/disable": { post: { summary: "Desactiva MFA (contraseña + código)", auth: "bearer", status: "204" } },
  "/v1/admin/audit": { get: { summary: "Bitácora de auditoría", auth: "bearer", roles: "platform_admin + MFA", status: "200" } },
  "/v1/admin/users/{id}/roles": { patch: { summary: "Asigna roles", auth: "bearer", roles: "platform_admin + MFA", status: "204" } },
};

export function buildOpenApi(serverUrl: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const [path, methods] of Object.entries(ops)) {
    paths[path] = {};
    for (const [method, op] of Object.entries(methods)) {
      paths[path][method] = {
        summary: op.summary,
        ...(op.roles ? { description: `Requiere rol: ${op.roles}` } : {}),
        ...(op.auth === "bearer" ? { security: [{ bearer: [] }] } : {}),
        ...(op.auth === "cookie+csrf" ? { security: [{ refreshCookie: [], csrf: [] }] } : {}),
        responses: {
          [op.status]: { description: "OK" },
          default: { description: "Error", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      };
    }
  }
  return {
    openapi: "3.1.0",
    info: { title: "AntiSismo API", version: "0.1.0", description: "Servicios de cuenta (no camino crítico de alertas). Tiempos en epoch ms UTC." },
    servers: [{ url: serverUrl }],
    paths,
    components: {
      securitySchemes: {
        bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT (EdDSA)" },
        refreshCookie: { type: "apiKey", in: "cookie", name: "__Host-as_rt" },
        csrf: { type: "apiKey", in: "header", name: "X-CSRF-Token" },
      },
      schemas: {
        Error: {
          type: "object",
          required: ["code", "message", "requestId"],
          properties: { code: { type: "string" }, message: { type: "string" }, requestId: { type: "string" }, details: {} },
        },
      },
    },
  };
}
