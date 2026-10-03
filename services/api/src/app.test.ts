import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type CryptoKey } from "jose";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { base32Decode, totp } from "./lib/totp.js";
import { AuditModel, SessionModel, UserModel } from "./models/index.js";
import { WEB, cookiesOf, rawCookies, startHarness, tokenFromLink, type Harness } from "./test/harness.js";

let h: Harness;
const PASSWORD = "terremoto-seguro-2026";

beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.stop();
});

async function verifiedUser(email: string, password = PASSWORD) {
  await request(h.app).post("/v1/auth/register").send({ email, password }).expect(202);
  const token = tokenFromLink(h.mailer.last(email, "verify-email")?.vars.link);
  await request(h.app).post("/v1/auth/verify-email").send({ token }).expect(200);
}

async function login(email: string, password = PASSWORD) {
  const res = await request(h.app).post("/v1/auth/login").send({ email, password }).expect(200);
  const cookies = cookiesOf(res);
  return {
    access: res.body.accessToken as string,
    csrf: res.body.csrfToken as string,
    refresh: cookies.as_rt ?? "",
    cookieHeader: `as_rt=${cookies.as_rt}; as_csrf=${cookies.as_csrf}`,
    body: res.body as Record<string, unknown>,
  };
}

describe("plataforma", () => {
  it("healthz/readyz/jwks/openapi y cabeceras de seguridad", async () => {
    const health = await request(h.app).get("/healthz").expect(200);
    expect(health.headers["x-powered-by"]).toBeUndefined();
    expect(health.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(health.headers["x-content-type-options"]).toBe("nosniff");
    expect(health.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    await request(h.app).get("/readyz").expect(200, /"db":"up"/);
    const jwks = await request(h.app).get("/.well-known/jwks.json").expect(200);
    expect(jwks.body.keys[0]).toMatchObject({ crv: "Ed25519", alg: "EdDSA" });
    const spec = await request(h.app).get("/v1/openapi.json").expect(200);
    expect(spec.body.openapi).toBe("3.1.0");
    expect(Object.keys(spec.body.paths)).toContain("/v1/auth/refresh");
  });

  it("errores uniformes { code, message, requestId } y eco de X-Request-Id válido", async () => {
    const res = await request(h.app).get("/no-existe").set("X-Request-Id", "req-12345678").expect(404);
    expect(res.body).toEqual({ code: "NOT_FOUND", message: "Resource not found", requestId: "req-12345678" });
    const bad = await request(h.app).get("/healthz").set("X-Request-Id", "<script>");
    expect(bad.headers["x-request-id"]).not.toBe("<script>");
    const json = await request(h.app).post("/v1/auth/login").set("Content-Type", "application/json").send("{bad").expect(400);
    expect(json.body.code).toBe("INVALID_JSON");
    const big = await request(h.app).post("/v1/auth/login").send({ email: "a@b.co", password: "x".repeat(40_000) }).expect(413);
    expect(big.body.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("CORS solo para orígenes permitidos; Origin hostil bloqueado en mutaciones", async () => {
    const pre = await request(h.app).options("/v1/auth/login").set("Origin", WEB).set("Access-Control-Request-Method", "POST").expect(204);
    expect(pre.headers["access-control-allow-origin"]).toBe(WEB);
    expect(pre.headers["access-control-allow-credentials"]).toBe("true");
    const evilPre = await request(h.app).options("/v1/auth/login").set("Origin", "https://evil.example");
    expect(evilPre.headers["access-control-allow-origin"]).toBeUndefined();
    const evil = await request(h.app).post("/v1/auth/login").set("Origin", "https://evil.example").send({ email: "a@b.co", password: PASSWORD }).expect(403);
    expect(evil.body.code).toBe("CSRF_REJECTED");
  });
});

describe("registro y verificación", () => {
  it("política: mínimo 12, contraseña filtrada, campos desconocidos e inyección NoSQL", async () => {
    const weak = await request(h.app).post("/v1/auth/register").send({ email: "weak@example.com", password: "corta-11ch!" }).expect(400);
    expect(weak.body).toMatchObject({ code: "WEAK_PASSWORD", details: { issues: ["too_short"], min: 12 } });
    h.breach.result = "breached";
    await request(h.app).post("/v1/auth/register").send({ email: "b@example.com", password: PASSWORD }).expect(400, /BREACHED_PASSWORD/);
    h.breach.result = "unknown";
    await request(h.app).post("/v1/auth/register").send({ email: "degraded@example.com", password: PASSWORD }).expect(202);
    h.breach.result = "ok";
    await request(h.app).post("/v1/auth/register").send({ email: "x@example.com", password: PASSWORD, roles: ["platform_admin"] }).expect(400, /VALIDATION_ERROR/);
    await request(h.app).post("/v1/auth/login").send({ email: { $gt: "" }, password: PASSWORD }).expect(400, /VALIDATION_ERROR/);
  });

  it("defensa en profundidad: sanitizeFilter neutraliza operadores aunque se salte la validación", async () => {
    const injected = JSON.parse('{"email":{"$ne":null}}') as Record<string, unknown>;
    await expect(UserModel.findOne(injected).lean()).rejects.toThrow(/Cast to string failed/);
  });

  it("anti-enumeración: misma respuesta si la cuenta existe; se avisa por correo al dueño", async () => {
    const first = await request(h.app).post("/v1/auth/register").send({ email: "Ana@Example.com", password: PASSWORD }).expect(202);
    const second = await request(h.app).post("/v1/auth/register").send({ email: "ana@example.com", password: PASSWORD }).expect(202);
    expect(second.body).toEqual(first.body);
    expect(h.mailer.last("ana@example.com", "account-exists")).toBeDefined();
    const stored = await UserModel.findOne({ email: "ana@example.com" }).select("+passwordHash").lean();
    expect(stored?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(JSON.stringify(stored)).not.toContain(PASSWORD);
  });

  it("login exige correo verificado; el enlace es de un solo uso y va en el fragmento", async () => {
    await request(h.app).post("/v1/auth/login").send({ email: "ana@example.com", password: PASSWORD }).expect(403, /EMAIL_NOT_VERIFIED/);
    const link = h.mailer.last("ana@example.com", "verify-email")?.vars.link;
    expect(link?.startsWith(`${WEB}/auth/verify#token=`)).toBe(true);
    const token = tokenFromLink(link);
    await request(h.app).post("/v1/auth/verify-email").send({ token }).expect(200);
    await request(h.app).post("/v1/auth/verify-email").send({ token }).expect(401, /INVALID_TOKEN/);
  });
});

describe("login, refresh y logout", () => {
  beforeAll(async () => {
    await verifiedUser("luis@example.com");
  });

  it("credenciales inválidas: misma respuesta para correo inexistente y contraseña errónea", async () => {
    const unknown = await request(h.app).post("/v1/auth/login").send({ email: "nadie@example.com", password: PASSWORD }).expect(401);
    const wrong = await request(h.app).post("/v1/auth/login").send({ email: "luis@example.com", password: "otra-contraseña-larga" }).expect(401);
    expect(unknown.body.code).toBe("INVALID_CREDENTIALS");
    expect(wrong.body.code).toBe(unknown.body.code);
    expect(wrong.body.message).toBe(unknown.body.message);
  });

  it("cookies HttpOnly + SameSite=Strict, access token válido para /v1/me", async () => {
    const res = await request(h.app).post("/v1/auth/login").send({ email: "luis@example.com", password: PASSWORD }).expect(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const raw = rawCookies(res);
    const rt = raw.find((c) => c.startsWith("as_rt="));
    const csrf = raw.find((c) => c.startsWith("as_csrf="));
    for (const cookie of [rt, csrf]) {
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/Secure/);
      expect(cookie).toMatch(/SameSite=Strict/);
      expect(cookie).toMatch(/Path=\//);
    }
    const me = await request(h.app).get("/v1/me").set("Authorization", `Bearer ${res.body.accessToken}`).expect(200);
    expect(me.body).toMatchObject({ email: "luis@example.com", roles: ["user"], emailVerified: true, mfaEnabled: false });
    await request(h.app).get("/v1/me").expect(401, /UNAUTHENTICATED/);
    await request(h.app).get("/v1/me").set("Authorization", "Bearer abc.def.ghi").expect(401, /INVALID_TOKEN/);
  });

  it("refresh exige CSRF de doble envío y rota; reutilizar un refresh revoca toda la familia", async () => {
    const s = await login("luis@example.com");
    await request(h.app).post("/v1/auth/refresh").set("Cookie", s.cookieHeader).expect(403, /CSRF_REJECTED/);
    await request(h.app).post("/v1/auth/refresh").set("Cookie", s.cookieHeader).set("X-CSRF-Token", "x".repeat(32)).expect(403);

    const rotated = await request(h.app).post("/v1/auth/refresh").set("Cookie", s.cookieHeader).set("X-CSRF-Token", s.csrf).expect(200);
    const next = cookiesOf(rotated);
    expect(next.as_rt).toBeDefined();
    expect(next.as_rt).not.toBe(s.refresh);

    const reuse = await request(h.app).post("/v1/auth/refresh").set("Cookie", s.cookieHeader).set("X-CSRF-Token", s.csrf).expect(401);
    expect(reuse.body.code).toBe("INVALID_TOKEN");
    await request(h.app)
      .post("/v1/auth/refresh")
      .set("Cookie", `as_rt=${next.as_rt}; as_csrf=${next.as_csrf}`)
      .set("X-CSRF-Token", rotated.body.csrfToken)
      .expect(401);
    await request(h.app).get("/v1/me").set("Authorization", `Bearer ${rotated.body.accessToken}`).expect(401);
    expect(await AuditModel.exists({ action: "auth.refresh.reuse" })).toBeTruthy();
  });

  it("tras recargar la web, /csrf entrega un token nuevo que permite refrescar (solo con CORS permitido)", async () => {
    const s = await login("luis@example.com");
    const fresh = await request(h.app).get("/v1/auth/csrf").set("Origin", WEB).expect(200);
    expect(fresh.headers["access-control-allow-origin"]).toBe(WEB);
    expect(fresh.headers["cache-control"]).toBe("no-store");
    const csrfCookie = cookiesOf(fresh).as_csrf;
    expect(fresh.body.csrfToken).toBe(csrfCookie);
    const evil = await request(h.app).get("/v1/auth/csrf").set("Origin", "https://evil.example").expect(200);
    expect(evil.headers["access-control-allow-origin"]).toBeUndefined();
    await request(h.app)
      .post("/v1/auth/refresh")
      .set("Cookie", `as_rt=${s.refresh}; as_csrf=${csrfCookie}`)
      .set("X-CSRF-Token", fresh.body.csrfToken)
      .expect(200);
  });

  it("logout revoca la sesión y el access token deja de servir de inmediato", async () => {
    const s = await login("luis@example.com");
    await request(h.app).post("/v1/auth/logout").set("Cookie", s.cookieHeader).expect(403, /CSRF_REJECTED/);
    await request(h.app).get("/v1/me").set("Authorization", `Bearer ${s.access}`).expect(200);
    await request(h.app).post("/v1/auth/logout").set("Cookie", s.cookieHeader).set("X-CSRF-Token", s.csrf).expect(204);
    await request(h.app).get("/v1/me").set("Authorization", `Bearer ${s.access}`).expect(401);
  });

  it("bloqueo progresivo tras intentos fallidos; se libera al expirar", async () => {
    await verifiedUser("lock@example.com");
    for (let i = 0; i < h.deps.env.API_LOCKOUT_THRESHOLD; i++) {
      await request(h.app).post("/v1/auth/login").send({ email: "lock@example.com", password: "incorrecta-larga-1" }).expect(401);
    }
    await request(h.app).post("/v1/auth/login").send({ email: "lock@example.com", password: PASSWORD }).expect(401, /INVALID_CREDENTIALS/);
    expect(await AuditModel.exists({ action: "auth.lockout" })).toBeTruthy();
    h.clock.now += h.deps.env.API_LOCKOUT_BASE_MS + 1000;
    await request(h.app).post("/v1/auth/login").send({ email: "lock@example.com", password: PASSWORD }).expect(200);
  });
});

describe("restablecer contraseña", () => {
  it("anti-enumeración, token de un solo uso, no se quema con contraseña débil y revoca sesiones", async () => {
    await verifiedUser("rosa@example.com");
    const before = await login("rosa@example.com");
    const unknown = await request(h.app).post("/v1/auth/password/forgot").send({ email: "nadie@example.com" }).expect(202);
    const known = await request(h.app).post("/v1/auth/password/forgot").send({ email: "rosa@example.com" }).expect(202);
    expect(known.body).toEqual(unknown.body);
    const token = tokenFromLink(h.mailer.last("rosa@example.com", "reset-password")?.vars.link);

    await request(h.app).post("/v1/auth/password/reset").send({ token, password: "corta" }).expect(400, /WEAK_PASSWORD/);
    await request(h.app).post("/v1/auth/password/reset").send({ token, password: "nueva-frase-muy-segura" }).expect(200);
    await request(h.app).post("/v1/auth/password/reset").send({ token, password: "otra-frase-muy-segura" }).expect(401);

    await request(h.app).get("/v1/me").set("Authorization", `Bearer ${before.access}`).expect(401);
    await request(h.app).post("/v1/auth/login").send({ email: "rosa@example.com", password: PASSWORD }).expect(401);
    await login("rosa@example.com", "nueva-frase-muy-segura");
    expect(h.mailer.last("rosa@example.com", "password-changed")).toBeDefined();
  });
});

describe("MFA TOTP", () => {
  it("setup → enable → login en dos pasos, anti-replay y códigos de recuperación de un uso", async () => {
    await verifiedUser("mfa@example.com");
    const s = await login("mfa@example.com");
    const auth = { Authorization: `Bearer ${s.access}` };
    const setup = await request(h.app).post("/v1/me/mfa/setup").set(auth).expect(200);
    expect(setup.body.otpauthUri).toMatch(/^otpauth:\/\/totp\/AntiSismo%3Amfa%40example\.com\?/);
    const secret = base32Decode(setup.body.secret);
    const stored = await UserModel.findOne({ email: "mfa@example.com" }).select("+mfa.pendingSecretEnc").lean();
    expect(stored?.mfa.pendingSecretEnc).toMatch(/^v1\./);
    expect(stored?.mfa.pendingSecretEnc).not.toContain(setup.body.secret);

    await request(h.app).post("/v1/me/mfa/enable").set(auth).send({ code: "000000" }).expect(401, /INVALID_MFA_CODE/);
    const code = totp(secret, h.clock.now);
    const enabled = await request(h.app).post("/v1/me/mfa/enable").set(auth).send({ code }).expect(200);
    expect(enabled.body.recoveryCodes).toHaveLength(10);

    const step1 = await request(h.app).post("/v1/auth/login").send({ email: "mfa@example.com", password: PASSWORD }).expect(200);
    expect(step1.body).toMatchObject({ mfaRequired: true });
    expect(step1.body.accessToken).toBeUndefined();
    await request(h.app).post("/v1/auth/login/mfa").send({ mfaToken: step1.body.mfaToken, code }).expect(401);

    h.clock.now += 30_000;
    const ok = await request(h.app).post("/v1/auth/login/mfa").send({ mfaToken: step1.body.mfaToken, code: totp(secret, h.clock.now) }).expect(200);
    const claims = JSON.parse(Buffer.from(String(ok.body.accessToken).split(".")[1] ?? "", "base64url").toString());
    expect(claims.mfa).toBe(true);

    const recovery = enabled.body.recoveryCodes[0] as string;
    const step2 = await request(h.app).post("/v1/auth/login").send({ email: "mfa@example.com", password: PASSWORD }).expect(200);
    await request(h.app).post("/v1/auth/login/mfa").send({ mfaToken: step2.body.mfaToken, code: recovery.toLowerCase() }).expect(200);
    await request(h.app).post("/v1/auth/login/mfa").send({ mfaToken: step2.body.mfaToken, code: recovery }).expect(401);
    await request(h.app).post("/v1/auth/login/mfa").send({ mfaToken: "x".repeat(40), code }).expect(401, /INVALID_TOKEN/);
  });
});

describe("perfil, sesiones y RBAC", () => {
  let user: Awaited<ReturnType<typeof login>>;

  beforeAll(async () => {
    await verifiedUser("perfil@example.com");
    await verifiedUser("otro@example.com");
    user = await login("perfil@example.com");
  });

  it("teléfono cifrado en reposo y devuelto descifrado; validación E.164", async () => {
    const auth = { Authorization: `Bearer ${user.access}` };
    await request(h.app).patch("/v1/me").set(auth).send({ phone: "809-555-0100" }).expect(400);
    const res = await request(h.app).patch("/v1/me").set(auth).send({ phone: "+18095550100", locale: "en" }).expect(200);
    expect(res.body).toMatchObject({ phone: "+18095550100", locale: "en" });
    const stored = await UserModel.findOne({ email: "perfil@example.com" }).lean();
    expect(stored?.phoneEnc).toMatch(/^v1\./);
    expect(stored?.phoneEnc).not.toContain("8095550100");
  });

  it("lista y revoca solo sesiones propias (epoch ms)", async () => {
    const second = await login("perfil@example.com");
    const other = await login("otro@example.com");
    const list = await request(h.app).get("/v1/me/sessions").set("Authorization", `Bearer ${user.access}`).expect(200);
    expect(list.body.sessions.length).toBeGreaterThanOrEqual(2);
    expect(list.body.sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    expect(typeof list.body.sessions[0].createdAt).toBe("number");

    const otherUser = await UserModel.findOne({ email: "otro@example.com" }).lean();
    if (!otherUser) throw new Error("usuario de prueba ausente");
    const otherSession = await SessionModel.findOne({ userId: otherUser._id, revokedAt: null }).lean();
    await request(h.app).delete(`/v1/me/sessions/${String(otherSession?._id)}`).set("Authorization", `Bearer ${user.access}`).expect(404);
    await request(h.app).get("/v1/me").set("Authorization", `Bearer ${other.access}`).expect(200);

    const secondId = (list.body.sessions as { id: string; current: boolean }[]).find((s) => !s.current)?.id;
    await request(h.app).delete(`/v1/me/sessions/${secondId}`).set("Authorization", `Bearer ${user.access}`).expect(204);
    await request(h.app).get("/v1/me").set("Authorization", `Bearer ${second.access}`).expect(401);
    await request(h.app).delete("/v1/me/sessions/not-an-id").set("Authorization", `Bearer ${user.access}`).expect(400);
  });

  it("cerrar las demás sesiones conserva la actual y no toca cuentas ajenas", async () => {
    await verifiedUser("multi@example.com");
    const current = await login("multi@example.com");
    const a = await login("multi@example.com");
    const b = await login("multi@example.com");
    const stranger = await login("otro@example.com");
    const res = await request(h.app).post("/v1/me/sessions/revoke-others").set("Authorization", `Bearer ${current.access}`).expect(200);
    expect(res.body.revoked).toBe(2);
    await request(h.app).get("/v1/me").set("Authorization", `Bearer ${current.access}`).expect(200);
    for (const s of [a, b]) await request(h.app).get("/v1/me").set("Authorization", `Bearer ${s.access}`).expect(401);
    await request(h.app).get("/v1/me").set("Authorization", `Bearer ${stranger.access}`).expect(200);
    await request(h.app).post("/v1/auth/refresh").set("Cookie", a.cookieHeader).set("X-CSRF-Token", a.csrf).expect(401);
    const audit = await AuditModel.findOne({ action: "session.revoke_others" }).lean();
    expect(audit?.meta).toMatchObject({ revoked: 2 });
  });

  it("términos: registro guarda la versión vigente; una versión vieja se rechaza; se puede aceptar después", async () => {
    const version = h.deps.env.API_TERMS_VERSION;
    await request(h.app).post("/v1/auth/register").send({ email: "old@example.com", password: PASSWORD, termsVersion: "2020-01-01" }).expect(409, /TERMS_OUTDATED/);
    expect(await UserModel.exists({ email: "old@example.com" })).toBeNull();
    await request(h.app).post("/v1/auth/register").send({ email: "terms@example.com", password: PASSWORD, termsVersion: version }).expect(202);
    const stored = await UserModel.findOne({ email: "terms@example.com" }).lean();
    expect(stored?.terms?.version).toBe(version);
    expect(stored?.terms?.acceptedAt).toBeInstanceOf(Date);

    const auth = { Authorization: `Bearer ${user.access}` };
    await request(h.app).post("/v1/me/terms").set(auth).send({ termsVersion: "2020-01-01" }).expect(409);
    await request(h.app).post("/v1/me/terms").set(auth).send({ termsVersion: "bad" }).expect(400);
    const accepted = await request(h.app).post("/v1/me/terms").set(auth).send({ termsVersion: version }).expect(200);
    expect(accepted.body.termsVersion).toBe(version);
  });

  it("admin exige rol platform_admin Y sesión con MFA; auditoría sin PII", async () => {
    await request(h.app).get("/v1/admin/audit").set("Authorization", `Bearer ${user.access}`).expect(403, /FORBIDDEN/);

    await UserModel.updateOne({ email: "perfil@example.com" }, { $set: { roles: ["user", "platform_admin"] } });
    const noMfa = await login("perfil@example.com");
    await request(h.app).get("/v1/admin/audit").set("Authorization", `Bearer ${noMfa.access}`).expect(403);

    const setup = await request(h.app).post("/v1/me/mfa/setup").set("Authorization", `Bearer ${noMfa.access}`).expect(200);
    const secret = base32Decode(setup.body.secret);
    await request(h.app).post("/v1/me/mfa/enable").set("Authorization", `Bearer ${noMfa.access}`).send({ code: totp(secret, h.clock.now) }).expect(200);
    h.clock.now += 30_000;
    const step = await request(h.app).post("/v1/auth/login").send({ email: "perfil@example.com", password: PASSWORD }).expect(200);
    const admin = await request(h.app).post("/v1/auth/login/mfa").send({ mfaToken: step.body.mfaToken, code: totp(secret, h.clock.now) }).expect(200);
    const bearer = { Authorization: `Bearer ${admin.body.accessToken}` };

    const audit = await request(h.app).get("/v1/admin/audit?limit=200").set(bearer).expect(200);
    expect(audit.body.entries.length).toBeGreaterThan(5);
    const dump = JSON.stringify(audit.body);
    expect(dump).not.toMatch(/@example\.com/);
    expect(dump).not.toContain("127.0.0.1");
    expect(dump).not.toContain(PASSWORD);

    const me = await request(h.app).get("/v1/me").set(bearer).expect(200);
    await request(h.app).patch(`/v1/admin/users/${me.body.id}/roles`).set(bearer).send({ roles: ["user"] }).expect(409, /SELF_DEMOTION/);
    const otherUser = await UserModel.findOne({ email: "otro@example.com" }).lean();
    await request(h.app).patch(`/v1/admin/users/${String(otherUser?._id)}/roles`).set(bearer).send({ roles: ["user", "org_admin"] }).expect(204);
    await request(h.app).patch(`/v1/admin/users/${String(otherUser?._id)}/roles`).set(bearer).send({ roles: ["root"] }).expect(400);
    expect((await UserModel.findById(otherUser?._id).lean())?.roles).toEqual(["user", "org_admin"]);
  });
});

describe("Google OAuth 2.0 + PKCE", () => {
  let signer: CryptoKey;

  beforeAll(async () => {
    const pair = await generateKeyPair("RS256");
    signer = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: "g1", alg: "RS256" };
    h.google.jwks = createLocalJWKSet({ keys: [jwk] });
  });

  async function idToken(nonce: string, overrides: Record<string, unknown> = {}) {
    return new SignJWT({ email: "Gina@Gmail.com", email_verified: true, name: "Gina", nonce, ...overrides })
      .setProtectedHeader({ alg: "RS256", kid: "g1" })
      .setIssuer("https://accounts.google.com")
      .setAudience(h.deps.env.API_GOOGLE_CLIENT_ID ?? "")
      .setSubject("google-sub-1")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(signer);
  }

  async function start() {
    const res = await request(h.app).get("/v1/auth/google/start").expect(302);
    const location = new URL(res.headers.location ?? "");
    const oauthCookie = rawCookies(res).find((c) => c.startsWith("as_oauth="));
    expect(oauthCookie).toMatch(/HttpOnly/);
    expect(oauthCookie).toMatch(/Secure/);
    expect(oauthCookie).toMatch(/SameSite=Lax/);
    const sealed = decodeURIComponent(cookiesOf(res).as_oauth ?? "");
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(sealed).not.toContain(location.searchParams.get("state") ?? "<none>");
    expect(sealed).not.toContain(location.searchParams.get("nonce") ?? "<none>");
    return {
      location,
      cookie: `as_oauth=${cookiesOf(res).as_oauth}`,
      state: location.searchParams.get("state") ?? "",
      nonce: location.searchParams.get("nonce") ?? "",
    };
  }

  it("redirige a Google con S256, state y nonce; callback válido crea sesión verificada", async () => {
    const s = await start();
    expect(s.location.origin + s.location.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(s.location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(s.location.searchParams.get("redirect_uri")).toBe(`${h.deps.env.API_PUBLIC_ORIGIN}/v1/auth/google/callback`);

    h.google.idToken = await idToken(s.nonce);
    const cb = await request(h.app).get(`/v1/auth/google/callback?code=abc&state=${s.state}`).set("Cookie", s.cookie).expect(302);
    expect(cb.headers.location).toBe(`${WEB}/auth/callback`);
    expect(cookiesOf(cb).as_rt).toBeDefined();
    const user = await UserModel.findOne({ email: "gina@gmail.com" }).lean();
    expect(user?.googleSub).toBe("google-sub-1");
    expect(user?.emailVerifiedAt).toBeInstanceOf(Date);
  });

  it("rechaza state distinto, sin cookie, nonce erróneo o correo no verificado (sin filtrar detalles)", async () => {
    const before = h.google.fetchCalls;
    const s = await start();
    const bad = await request(h.app).get(`/v1/auth/google/callback?code=abc&state=${"x".repeat(32)}`).set("Cookie", s.cookie).expect(302);
    expect(bad.headers.location).toBe(`${WEB}/auth/login#error=oauth`);
    await request(h.app).get(`/v1/auth/google/callback?code=abc&state=${s.state}`).expect(302, /error=oauth/);
    const tampered = s.cookie.slice(0, -2) + (s.cookie.endsWith("AA") ? "BB" : "AA");
    await request(h.app).get(`/v1/auth/google/callback?code=abc&state=${s.state}`).set("Cookie", tampered).expect(302, /error=oauth/);
    h.clock.now += 601_000;
    await request(h.app).get(`/v1/auth/google/callback?code=abc&state=${s.state}`).set("Cookie", s.cookie).expect(302, /error=oauth/);
    expect(h.google.fetchCalls).toBe(before);

    const s2 = await start();
    h.google.idToken = await idToken("otro-nonce");
    const wrongNonce = await request(h.app).get(`/v1/auth/google/callback?code=abc&state=${s2.state}`).set("Cookie", s2.cookie).expect(302);
    expect(wrongNonce.headers.location).toContain("error=oauth");
    expect(cookiesOf(wrongNonce).as_rt).toBeUndefined();

    const s3 = await start();
    h.google.idToken = await idToken(s3.nonce, { email: "nuevo@gmail.com", email_verified: false, sub: "google-sub-2" });
    await request(h.app).get(`/v1/auth/google/callback?code=abc&state=${s3.state}`).set("Cookie", s3.cookie).expect(302, /error=oauth/);
    expect(await UserModel.exists({ email: "nuevo@gmail.com" })).toBeNull();
  });
});
