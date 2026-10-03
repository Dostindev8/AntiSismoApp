import { z } from "zod";

/**
 * Contratos del API de cuentas (`services/api`). Sin dependencias de Node: se usan en el navegador para
 * validar cada respuesta antes de confiar en ella. Tiempos en epoch ms UTC.
 */

export const ACCOUNT_LOCALES = ["es-DO", "en", "fr", "pt"] as const;

export const AccountErrorSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]{1,60}$/),
  message: z.string().max(500),
  requestId: z.string().max(128),
  details: z.unknown().optional(),
});
export type AccountError = z.infer<typeof AccountErrorSchema>;

export const PublicUserSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{24}$/),
  email: z.email(),
  displayName: z.string().max(80).nullable(),
  roles: z.array(z.string().max(40)).max(10),
  locale: z.enum(ACCOUNT_LOCALES),
  emailVerified: z.boolean(),
  mfaEnabled: z.boolean(),
  phone: z.string().max(20).nullable(),
  termsVersion: z.string().max(20).nullable().optional(),
});
export type PublicUser = z.infer<typeof PublicUserSchema>;

export const SessionResponseSchema = z.object({
  accessToken: z.string().min(20).max(4096),
  tokenType: z.literal("Bearer"),
  expiresIn: z.number().int().positive(),
  csrfToken: z.string().min(16).max(256),
  user: PublicUserSchema,
});
export type SessionResponse = z.infer<typeof SessionResponseSchema>;

export const LoginResponseSchema = z.union([
  SessionResponseSchema,
  z.object({ mfaRequired: z.literal(true), mfaToken: z.string().min(20).max(4096) }),
]);
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

export const CsrfResponseSchema = z.object({ csrfToken: z.string().min(16).max(256) });

export const SessionInfoSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{24}$/),
  current: z.boolean(),
  mfa: z.boolean(),
  userAgent: z.string().max(200),
  createdAt: z.number().int(),
  lastUsedAt: z.number().int(),
  expiresAt: z.number().int(),
});
export type SessionInfo = z.infer<typeof SessionInfoSchema>;
export const SessionListSchema = z.object({ sessions: z.array(SessionInfoSchema).max(50) });

export const MfaSetupSchema = z.object({ secret: z.string().regex(/^[A-Z2-7]{16,128}$/), otpauthUri: z.string().startsWith("otpauth://totp/") });
export const RecoveryCodesSchema = z.object({ recoveryCodes: z.array(z.string().regex(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){3}$/)).length(10) });
export const RevokeOthersSchema = z.object({ revoked: z.number().int().min(0) });
export const AcceptedSchema = z.object({ status: z.string().max(40) });
export const AuthPolicySchema = z.object({
  termsVersion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  password: z.object({ min: z.number().int().min(8).max(128), max: z.number().int().min(16).max(1024) }),
  google: z.boolean(),
});
export type AuthPolicy = z.infer<typeof AuthPolicySchema>;
