import {
  AccountErrorSchema,
  AuthPolicySchema,
  CsrfResponseSchema,
  LoginResponseSchema,
  MfaSetupSchema,
  PublicUserSchema,
  RecoveryCodesSchema,
  RevokeOthersSchema,
  SessionListSchema,
  SessionResponseSchema,
} from "@antisismo/proto/account";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { totp, base32Decode } from "./lib/totp.js";
import { WEB, startHarness, tokenFromLink, type Harness } from "./test/harness.js";

let h: Harness;
const PASSWORD = "placa-tectonica-caribe-2026";

beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.stop();
});

describe("las respuestas reales del API cumplen los contratos que valida la web (@antisismo/proto/account)", () => {
  it("registro → verificación → login → perfil → sesiones → MFA → csrf → errores", async () => {
    const email = "contrato@example.com";
    const policy = AuthPolicySchema.parse((await request(h.app).get("/v1/auth/policy").expect(200)).body);
    expect(policy).toEqual({ termsVersion: h.deps.env.API_TERMS_VERSION, password: { min: h.deps.env.API_PASSWORD_MIN, max: h.deps.env.API_PASSWORD_MAX }, google: true });
    await request(h.app).post("/v1/auth/register").send({ email, password: PASSWORD, termsVersion: h.deps.env.API_TERMS_VERSION }).expect(202);
    await request(h.app).post("/v1/auth/verify-email").send({ token: tokenFromLink(h.mailer.last(email, "verify-email")?.vars.link) }).expect(200);

    const login = await request(h.app).post("/v1/auth/login").send({ email, password: PASSWORD }).expect(200);
    const session = SessionResponseSchema.parse(login.body);
    expect(LoginResponseSchema.safeParse(login.body).success).toBe(true);
    const auth = { Authorization: `Bearer ${session.accessToken}` };

    PublicUserSchema.parse((await request(h.app).get("/v1/me").set(auth).expect(200)).body);
    SessionListSchema.parse((await request(h.app).get("/v1/me/sessions").set(auth).expect(200)).body);
    RevokeOthersSchema.parse((await request(h.app).post("/v1/me/sessions/revoke-others").set(auth).expect(200)).body);
    CsrfResponseSchema.parse((await request(h.app).get("/v1/auth/csrf").set("Origin", WEB).expect(200)).body);

    const setup = MfaSetupSchema.parse((await request(h.app).post("/v1/me/mfa/setup").set(auth).expect(200)).body);
    const code = totp(base32Decode(setup.secret), h.clock.now);
    RecoveryCodesSchema.parse((await request(h.app).post("/v1/me/mfa/enable").set(auth).send({ code }).expect(200)).body);
    const mfaLogin = await request(h.app).post("/v1/auth/login").send({ email, password: PASSWORD }).expect(200);
    expect(LoginResponseSchema.parse(mfaLogin.body)).toMatchObject({ mfaRequired: true });

    const bad = await request(h.app).post("/v1/auth/login").send({ email, password: "incorrecta-123456" }).expect(401);
    expect(AccountErrorSchema.parse(bad.body).code).toBe("INVALID_CREDENTIALS");
  });
});

describe("límites separados: agotar el de login no bloquea renovar la sesión", () => {
  let strict: Harness;
  beforeAll(async () => {
    await h.stop();
    strict = await startHarness({ API_RATE_AUTH_MAX: "3", API_RATE_SESSION_MAX: "10" });
  });
  afterAll(async () => {
    await strict.stop();
    h = await startHarness();
  });

  it("login 429 tras 3 intentos; /csrf sigue respondiendo hasta su propio límite", async () => {
    for (let i = 0; i < 3; i++) await request(strict.app).post("/v1/auth/login").send({ email: "x@example.com", password: "nada-que-ver-1234" }).expect(401);
    const limited = await request(strict.app).post("/v1/auth/login").send({ email: "x@example.com", password: "nada-que-ver-1234" }).expect(429);
    expect(AccountErrorSchema.parse(limited.body).code).toBe("RATE_LIMITED");
    for (let i = 0; i < 10; i++) await request(strict.app).get("/v1/auth/csrf").set("Origin", WEB).expect(200);
    await request(strict.app).get("/v1/auth/csrf").set("Origin", WEB).expect(429);
  });
});
