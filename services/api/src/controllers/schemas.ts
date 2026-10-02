import { z } from "zod";
import { LOCALES, ROLES } from "../models/roles.js";

const email = z.email().max(254).transform((v) => v.toLowerCase());
const password = z.string().min(1).max(1024);
const opaqueToken = z.string().regex(/^[A-Za-z0-9_-]{32,128}$/);

export const registerBody = z.strictObject({
  email,
  password,
  displayName: z.string().trim().min(1).max(80).optional(),
  locale: z.enum(LOCALES).optional(),
});

export const loginBody = z.strictObject({ email, password });
export const emailBody = z.strictObject({ email });
export const tokenBody = z.strictObject({ token: opaqueToken });
export const resetBody = z.strictObject({ token: opaqueToken, password });
export const mfaLoginBody = z.strictObject({ mfaToken: z.string().min(20).max(2048), code: z.string().trim().min(6).max(24) });
export const totpBody = z.strictObject({ code: z.string().regex(/^\d{6}$/) });
export const mfaDisableBody = z.strictObject({ password, code: z.string().trim().min(6).max(24) });

export const updateMeBody = z
  .strictObject({
    displayName: z.string().trim().min(1).max(80).nullable().optional(),
    locale: z.enum(LOCALES).optional(),
    phone: z.string().regex(/^\+[1-9]\d{7,14}$/, "E.164").nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "empty update");

export const idParam = z.strictObject({ id: z.string().regex(/^[a-f0-9]{24}$/) });
export const rolesBody = z.strictObject({ roles: z.array(z.enum(ROLES)).min(1).max(ROLES.length) });
export const auditQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });
export const oauthFlow = z.strictObject({
  state: z.string().min(16).max(256),
  verifier: z.string().min(43).max(128),
  nonce: z.string().min(16).max(256),
  exp: z.number().int().positive(),
});
export const oauthCallbackQuery = z.object({ code: z.string().min(1).max(2048), state: z.string().min(16).max(256) });
