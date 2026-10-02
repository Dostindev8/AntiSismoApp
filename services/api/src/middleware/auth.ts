import type { RequestHandler, Response } from "express";
import type { Types } from "mongoose";
import { errors } from "../lib/errors.js";
import type { AccessClaims, TokenService } from "../lib/tokens.js";
import type { Role } from "../models/roles.js";
import { toObjectId } from "../repositories/index.js";

export interface AuthContext extends AccessClaims {
  userId: Types.ObjectId;
  sessionId: Types.ObjectId;
}

export function authOf(res: Response): AuthContext {
  const ctx = res.locals.auth as AuthContext | undefined;
  if (!ctx) throw errors.unauthenticated();
  return ctx;
}

/** Bearer EdDSA + comprobación de sesión viva (revocación inmediata). */
export function requireAuth(tokens: TokenService, sessionIsActive: (sid: Types.ObjectId) => Promise<boolean>): RequestHandler {
  return async (req, res, next) => {
    const header = req.get("authorization");
    const match = header ? /^Bearer ([A-Za-z0-9._-]+)$/.exec(header) : null;
    if (!match?.[1]) return next(errors.unauthenticated());
    let claims: AccessClaims;
    try {
      claims = await tokens.verifyAccess(match[1]);
    } catch {
      return next(errors.invalidToken());
    }
    const userId = toObjectId(claims.sub);
    const sessionId = toObjectId(claims.sid);
    if (!userId || !sessionId || !(await sessionIsActive(sessionId))) return next(errors.invalidToken());
    res.locals.auth = { ...claims, userId, sessionId } satisfies AuthContext;
    next();
  };
}

export function requireRole(...allowed: Role[]): RequestHandler {
  return (_req, res, next) => {
    const ctx = res.locals.auth as AuthContext | undefined;
    if (!ctx) return next(errors.unauthenticated());
    if (!ctx.roles.some((r) => allowed.includes(r))) return next(errors.forbidden());
    next();
  };
}

/** Acciones administrativas exigen sesión verificada con segundo factor. */
export const requireMfaSession: RequestHandler = (_req, res, next) => {
  const ctx = res.locals.auth as AuthContext | undefined;
  if (!ctx?.mfa) return next(errors.forbidden());
  next();
};
