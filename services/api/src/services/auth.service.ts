import { createHash } from "node:crypto";
import type { Types } from "mongoose";
import type { AppDeps, RequestMeta } from "../context.js";
import { errors } from "../lib/errors.js";
import { burnPasswordCheck, checkPolicy, hashPassword, verifyPassword } from "../lib/password.js";
import { hashToken, newOpaqueToken } from "../lib/tokens.js";
import { verifyTotp } from "../lib/totp.js";
import type { UserDoc } from "../models/index.js";
import type { Locale } from "../models/roles.js";
import { oneTimeTokensRepo, sessionsRepo, toObjectId, usersRepo } from "../repositories/index.js";
import type { Auditor } from "./audit.service.js";
import type { GoogleIdentity } from "./google.service.js";

export interface PublicUser {
  id: string;
  email: string;
  displayName: string | null;
  roles: string[];
  locale: Locale;
  emailVerified: boolean;
  mfaEnabled: boolean;
  phone: string | null;
}

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: PublicUser;
}

export type LoginResult = { kind: "session"; session: IssuedSession } | { kind: "mfa"; mfaToken: string };

const MFA_PURPOSE = "mfa";

export const phoneAad = (userId: string) => `user:${userId}:phone`;
export const mfaAad = (userId: string) => `user:${userId}:mfa`;
export const hashRecoveryCode = (code: string) => createHash("sha256").update(code.replace(/[\s-]/g, "").toUpperCase()).digest("hex");

export function createAuthService(deps: AppDeps, audit: Auditor) {
  const { env, tokens, cipher, mailer } = deps;
  const policy = { min: env.API_PASSWORD_MIN, max: env.API_PASSWORD_MAX };
  const now = () => new Date(deps.now());

  function toPublic(user: UserDoc): PublicUser {
    const id = String(user._id);
    let phone: string | null = null;
    if (user.phoneEnc) {
      try {
        phone = cipher.decrypt(user.phoneEnc, phoneAad(id));
      } catch {
        deps.logger.error({ userId: id }, "phone decrypt failed");
      }
    }
    return {
      id,
      email: user.email,
      displayName: user.displayName ?? null,
      roles: user.roles,
      locale: user.locale,
      emailVerified: Boolean(user.emailVerifiedAt),
      mfaEnabled: user.mfa.enabled,
      phone,
    };
  }

  async function assertAcceptablePassword(password: string, email: string) {
    const issues = checkPolicy(password, policy, email);
    if (issues.length > 0) throw errors.weakPassword({ issues, min: policy.min });
    if (env.API_HIBP_ENABLED) {
      const result = await deps.breachChecker(password);
      if (result === "breached") throw errors.breachedPassword();
      if (result === "unknown") deps.logger.warn("breach check degraded (HIBP unavailable)");
    }
  }

  async function sendOneTimeLink(user: UserDoc, purpose: "verify_email" | "reset_password", ttlS: number) {
    const { token, hash } = newOpaqueToken();
    await oneTimeTokensRepo.create(user._id, purpose, hash, new Date(deps.now() + ttlS * 1000));
    const path = purpose === "verify_email" ? "/auth/verify" : "/auth/reset";
    await mailer.send({
      to: user.email,
      template: purpose === "verify_email" ? "verify-email" : "reset-password",
      locale: user.locale,
      vars: { link: `${env.API_WEB_ORIGIN}${path}#token=${token}`, expiresInMinutes: String(Math.round(ttlS / 60)) },
    });
  }

  async function issueSession(user: UserDoc, mfa: boolean, meta: RequestMeta): Promise<IssuedSession> {
    const { token, hash } = newOpaqueToken();
    const t = now();
    const session = await sessionsRepo.create({
      userId: user._id,
      currentHash: hash,
      mfa,
      userAgent: meta.userAgent.slice(0, 200),
      ipIndex: meta.ip ? cipher.blindIndex(meta.ip) : "",
      createdAt: t,
      lastUsedAt: t,
      expiresAt: new Date(t.getTime() + env.API_REFRESH_TTL_S * 1000),
    });
    const accessToken = await tokens.signAccess({ sub: String(user._id), sid: String(session._id), roles: user.roles, mfa });
    return { accessToken, refreshToken: token, expiresIn: env.API_ACCESS_TTL_S, user: toPublic(user) };
  }

  async function registerFailedLogin(user: UserDoc, meta: RequestMeta) {
    const count = await usersRepo.registerFailure(user._id);
    if (count >= env.API_LOCKOUT_THRESHOLD) {
      const ms = Math.min(env.API_LOCKOUT_BASE_MS * 2 ** (count - env.API_LOCKOUT_THRESHOLD), env.API_LOCKOUT_MAX_MS);
      await usersRepo.update(user._id, { "lockout.lockedUntil": new Date(deps.now() + ms) });
      await audit(meta, { action: "auth.lockout", outcome: "failure", actorId: user._id, meta: { failedCount: count, lockMs: ms } });
    }
    await audit(meta, { action: "auth.login", outcome: "failure", actorId: user._id, meta: { reason: "bad_password" } });
  }

  async function verifySecondFactor(user: UserDoc, code: string): Promise<boolean> {
    const normalized = code.replace(/\s/g, "");
    if (/^\d{6}$/.test(normalized)) {
      if (!user.mfa.secretEnc) return false;
      const secret = Buffer.from(cipher.decrypt(user.mfa.secretEnc, mfaAad(String(user._id))), "base64");
      const step = verifyTotp(secret, normalized, deps.now());
      return step !== null && (await usersRepo.consumeTotpStep(user._id, step));
    }
    return usersRepo.consumeRecoveryCode(user._id, hashRecoveryCode(normalized));
  }

  return {
    toPublic,
    issueSession,
    verifySecondFactor,
    assertAcceptablePassword,

    async register(input: { email: string; password: string; displayName?: string | undefined; locale?: Locale | undefined }, meta: RequestMeta) {
      const email = input.email.toLowerCase();
      await assertAcceptablePassword(input.password, email);
      const passwordHash = await hashPassword(input.password);
      const existing = await usersRepo.findByEmail(email);
      if (existing) {
        await mailer.send({ to: existing.email, template: "account-exists", locale: existing.locale, vars: { loginUrl: `${env.API_WEB_ORIGIN}/auth/login` } });
        await audit(meta, { action: "auth.register", outcome: "failure", actorId: existing._id, meta: { reason: "exists" } });
        return;
      }
      try {
        const user = await usersRepo.create({ email, passwordHash, displayName: input.displayName ?? null, locale: input.locale ?? "es-DO" });
        await sendOneTimeLink(user, "verify_email", env.API_VERIFY_TTL_S);
        await audit(meta, { action: "auth.register", outcome: "success", actorId: user._id });
      } catch (err) {
        if ((err as { code?: number }).code === 11000) return;
        throw err;
      }
    },

    async resendVerification(emailRaw: string, meta: RequestMeta) {
      const user = await usersRepo.findByEmail(emailRaw);
      if (!user || user.emailVerifiedAt) return;
      await sendOneTimeLink(user, "verify_email", env.API_VERIFY_TTL_S);
      await audit(meta, { action: "auth.verify.resend", outcome: "success", actorId: user._id });
    },

    async verifyEmail(token: string, meta: RequestMeta) {
      const record = await oneTimeTokensRepo.consume(hashToken(token), "verify_email", now());
      if (!record) throw errors.invalidToken();
      await usersRepo.update(record.userId, { emailVerifiedAt: now() });
      await audit(meta, { action: "auth.verify", outcome: "success", actorId: record.userId });
    },

    async login(input: { email: string; password: string }, meta: RequestMeta): Promise<LoginResult> {
      const user = await usersRepo.findByEmailWithSecrets(input.email);
      if (!user || !user.passwordHash) {
        await burnPasswordCheck(input.password);
        throw errors.invalidCredentials();
      }
      if (user.lockout.lockedUntil && user.lockout.lockedUntil.getTime() > deps.now()) {
        await burnPasswordCheck(input.password);
        await audit(meta, { action: "auth.login", outcome: "failure", actorId: user._id, meta: { reason: "locked" } });
        throw errors.invalidCredentials();
      }
      if (!(await verifyPassword(user.passwordHash, input.password))) {
        await registerFailedLogin(user, meta);
        throw errors.invalidCredentials();
      }
      await usersRepo.update(user._id, { "lockout.failedCount": 0, "lockout.lockedUntil": null });
      if (!user.emailVerifiedAt) throw errors.emailNotVerified();
      if (user.mfa.enabled) {
        return { kind: "mfa", mfaToken: await tokens.signPurpose(MFA_PURPOSE, String(user._id), env.API_MFA_TOKEN_TTL_S) };
      }
      const session = await issueSession(user, false, meta);
      await audit(meta, { action: "auth.login", outcome: "success", actorId: user._id, meta: { mfa: false } });
      return { kind: "session", session };
    },

    async completeMfa(input: { mfaToken: string; code: string }, meta: RequestMeta): Promise<IssuedSession> {
      let sub: string;
      try {
        ({ sub } = await tokens.verifyPurpose(MFA_PURPOSE, input.mfaToken));
      } catch {
        throw errors.invalidToken();
      }
      const id = toObjectId(sub);
      const user = id ? await usersRepo.findByIdWithSecrets(id) : null;
      if (!user || !user.mfa.enabled) throw errors.invalidToken();
      if (user.lockout.lockedUntil && user.lockout.lockedUntil.getTime() > deps.now()) throw errors.invalidMfa();
      if (!(await verifySecondFactor(user, input.code))) {
        await registerFailedLogin(user, meta);
        throw errors.invalidMfa();
      }
      await usersRepo.update(user._id, { "lockout.failedCount": 0, "lockout.lockedUntil": null });
      const session = await issueSession(user, true, meta);
      await audit(meta, { action: "auth.login", outcome: "success", actorId: user._id, meta: { mfa: true } });
      return session;
    },

    async refresh(refreshToken: string, meta: RequestMeta): Promise<IssuedSession> {
      const oldHash = hashToken(refreshToken);
      const { token, hash } = newOpaqueToken();
      const t = now();
      const rotated = await sessionsRepo.rotate(oldHash, hash, t, new Date(t.getTime() + env.API_REFRESH_TTL_S * 1000));
      if (!rotated) {
        const reused = await sessionsRepo.findByPreviousHash(oldHash);
        if (reused && !reused.revokedAt) {
          await sessionsRepo.revoke(reused._id, "refresh_reuse", t);
          await audit(meta, { action: "auth.refresh.reuse", outcome: "failure", actorId: reused.userId, targetId: String(reused._id) });
        }
        throw errors.invalidToken();
      }
      const user = await usersRepo.findById(rotated.userId);
      if (!user) throw errors.invalidToken();
      const accessToken = await tokens.signAccess({ sub: String(user._id), sid: String(rotated._id), roles: user.roles, mfa: rotated.mfa });
      return { accessToken, refreshToken: token, expiresIn: env.API_ACCESS_TTL_S, user: toPublic(user) };
    },

    async logout(refreshToken: string, meta: RequestMeta) {
      const session = await sessionsRepo.findByCurrentHash(hashToken(refreshToken));
      if (!session) return;
      await sessionsRepo.revoke(session._id, "logout", now());
      await audit(meta, { action: "auth.logout", outcome: "success", actorId: session.userId, targetId: String(session._id) });
    },

    async forgotPassword(emailRaw: string, meta: RequestMeta) {
      const user = await usersRepo.findByEmail(emailRaw);
      if (!user) return;
      await sendOneTimeLink(user, "reset_password", env.API_RESET_TTL_S);
      await audit(meta, { action: "auth.password.forgot", outcome: "success", actorId: user._id });
    },

    async resetPassword(input: { token: string; password: string }, meta: RequestMeta) {
      const tokenHash = hashToken(input.token);
      const pending = await oneTimeTokensRepo.peek(tokenHash, "reset_password", now());
      const user = pending ? await usersRepo.findById(pending.userId) : null;
      if (!user) throw errors.invalidToken();
      await assertAcceptablePassword(input.password, user.email);
      const passwordHash = await hashPassword(input.password);
      if (!(await oneTimeTokensRepo.consume(tokenHash, "reset_password", now()))) throw errors.invalidToken();
      await usersRepo.update(user._id, {
        passwordHash,
        emailVerifiedAt: user.emailVerifiedAt ?? now(),
        "lockout.failedCount": 0,
        "lockout.lockedUntil": null,
      });
      await sessionsRepo.revokeAllForUser(user._id, "password_reset", now());
      await mailer.send({ to: user.email, template: "password-changed", locale: user.locale, vars: {} });
      await audit(meta, { action: "auth.password.reset", outcome: "success", actorId: user._id });
    },

    async loginWithGoogle(identity: GoogleIdentity, meta: RequestMeta): Promise<LoginResult> {
      if (!identity.emailVerified) throw errors.emailNotVerified();
      let user = await usersRepo.findByGoogleSub(identity.sub);
      if (!user) {
        const byEmail = await usersRepo.findByEmail(identity.email);
        if (byEmail) {
          await usersRepo.update(byEmail._id, { googleSub: identity.sub, emailVerifiedAt: byEmail.emailVerifiedAt ?? now() });
          user = await usersRepo.findById(byEmail._id);
        } else {
          user = await usersRepo.create({ email: identity.email, passwordHash: null, displayName: identity.name, locale: "es-DO", emailVerifiedAt: now(), googleSub: identity.sub });
        }
      }
      if (!user) throw errors.invalidToken();
      if (user.mfa.enabled) {
        return { kind: "mfa", mfaToken: await tokens.signPurpose(MFA_PURPOSE, String(user._id), env.API_MFA_TOKEN_TTL_S) };
      }
      const session = await issueSession(user, false, meta);
      await audit(meta, { action: "auth.login.google", outcome: "success", actorId: user._id });
      return { kind: "session", session };
    },

    async sessionIsActive(sid: Types.ObjectId) {
      return Boolean(await sessionsRepo.isActive(sid, now()));
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
