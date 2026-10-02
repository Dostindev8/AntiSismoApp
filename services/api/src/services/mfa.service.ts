import { randomBytes } from "node:crypto";
import type { Types } from "mongoose";
import type { AppDeps, RequestMeta } from "../context.js";
import { errors } from "../lib/errors.js";
import { verifyPassword } from "../lib/password.js";
import { base32Encode, newTotpSecret, otpauthUri, verifyTotp } from "../lib/totp.js";
import { usersRepo } from "../repositories/index.js";
import type { Auditor } from "./audit.service.js";
import { hashRecoveryCode, mfaAad, type AuthService } from "./auth.service.js";

const RECOVERY_CODES = 10;
const ISSUER = "AntiSismo";

function newRecoveryCode(): string {
  const raw = base32Encode(randomBytes(10));
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
}

export function createMfaService(deps: AppDeps, audit: Auditor, auth: AuthService) {
  const { cipher } = deps;
  return {
    async setup(userId: Types.ObjectId) {
      const user = await usersRepo.findById(userId);
      if (!user) throw errors.notFound();
      if (user.mfa.enabled) throw errors.conflict("MFA_ALREADY_ENABLED", "MFA is already enabled");
      const secret = newTotpSecret();
      await usersRepo.update(userId, { "mfa.pendingSecretEnc": cipher.encrypt(secret.toString("base64"), mfaAad(String(userId))) });
      return { secret: base32Encode(secret), otpauthUri: otpauthUri(secret, user.email, ISSUER) };
    },

    async enable(userId: Types.ObjectId, code: string, meta: RequestMeta) {
      const user = await usersRepo.findByIdWithSecrets(userId);
      if (!user?.mfa.pendingSecretEnc) throw errors.conflict("MFA_SETUP_REQUIRED", "Start MFA setup first");
      const secretB64 = cipher.decrypt(user.mfa.pendingSecretEnc, mfaAad(String(userId)));
      const step = verifyTotp(Buffer.from(secretB64, "base64"), code, deps.now());
      if (step === null) throw errors.invalidMfa();
      const codes = Array.from({ length: RECOVERY_CODES }, newRecoveryCode);
      await usersRepo.update(userId, {
        "mfa.enabled": true,
        "mfa.secretEnc": user.mfa.pendingSecretEnc,
        "mfa.pendingSecretEnc": null,
        "mfa.lastUsedStep": step,
        "mfa.recoveryHashes": codes.map(hashRecoveryCode),
      });
      await audit(meta, { action: "mfa.enable", outcome: "success", actorId: userId });
      return { recoveryCodes: codes };
    },

    async disable(userId: Types.ObjectId, input: { password: string; code: string }, meta: RequestMeta) {
      const user = await usersRepo.findByIdWithSecrets(userId);
      if (!user?.mfa.enabled) throw errors.conflict("MFA_NOT_ENABLED", "MFA is not enabled");
      const passwordOk = user.passwordHash ? await verifyPassword(user.passwordHash, input.password) : false;
      if (!passwordOk || !(await auth.verifySecondFactor(user, input.code))) {
        await audit(meta, { action: "mfa.disable", outcome: "failure", actorId: userId });
        throw errors.invalidMfa();
      }
      await usersRepo.update(userId, {
        "mfa.enabled": false,
        "mfa.secretEnc": null,
        "mfa.pendingSecretEnc": null,
        "mfa.lastUsedStep": null,
        "mfa.recoveryHashes": [],
      });
      await audit(meta, { action: "mfa.disable", outcome: "success", actorId: userId });
    },
  };
}

export type MfaService = ReturnType<typeof createMfaService>;
