import type { Request, Response } from "express";
import type { AppDeps } from "../context.js";
import { errors } from "../lib/errors.js";
import { authOf } from "../middleware/auth.js";
import { metaOf } from "../middleware/security.js";
import { sessionsRepo, toObjectId, usersRepo } from "../repositories/index.js";
import type { Auditor } from "../services/audit.service.js";
import { phoneAad, type AuthService } from "../services/auth.service.js";
import type { MfaService } from "../services/mfa.service.js";
import { idParam, mfaDisableBody, termsBody, totpBody, updateMeBody } from "./schemas.js";

export function createMeController(deps: AppDeps, auth: AuthService, mfa: MfaService, audit: Auditor) {
  return {
    async get(_req: Request, res: Response) {
      const user = await usersRepo.findById(authOf(res).userId);
      if (!user) throw errors.notFound();
      res.json(auth.toPublic(user));
    },

    async update(req: Request, res: Response) {
      const { userId } = authOf(res);
      const body = updateMeBody.parse(req.body);
      const set: Record<string, unknown> = {};
      if (body.displayName !== undefined) set.displayName = body.displayName;
      if (body.locale !== undefined) set.locale = body.locale;
      if (body.phone !== undefined) set.phoneEnc = body.phone === null ? null : deps.cipher.encrypt(body.phone, phoneAad(String(userId)));
      await usersRepo.update(userId, set);
      await audit(metaOf(req, res), { action: "profile.update", outcome: "success", actorId: userId, meta: { fields: Object.keys(set).join(",") } });
      const user = await usersRepo.findById(userId);
      if (!user) throw errors.notFound();
      res.json(auth.toPublic(user));
    },

    async listSessions(_req: Request, res: Response) {
      const { userId, sessionId } = authOf(res);
      const sessions = await sessionsRepo.listActive(userId, new Date(deps.now()));
      res.json({
        sessions: sessions.map((s) => ({
          id: String(s._id),
          current: s._id.equals(sessionId),
          mfa: s.mfa,
          userAgent: s.userAgent,
          createdAt: s.createdAt.getTime(),
          lastUsedAt: s.lastUsedAt.getTime(),
          expiresAt: s.expiresAt.getTime(),
        })),
      });
    },

    async revokeSession(req: Request, res: Response) {
      const { userId } = authOf(res);
      const id = toObjectId(idParam.parse(req.params).id);
      if (!id || !(await sessionsRepo.revoke(id, "user_revoked", new Date(deps.now()), userId))) throw errors.notFound();
      await audit(metaOf(req, res), { action: "session.revoke", outcome: "success", actorId: userId, targetId: String(id) });
      res.status(204).end();
    },

    async revokeOtherSessions(req: Request, res: Response) {
      const { userId, sessionId } = authOf(res);
      const revoked = await sessionsRepo.revokeOthers(userId, sessionId, "user_revoked_others", new Date(deps.now()));
      await audit(metaOf(req, res), { action: "session.revoke_others", outcome: "success", actorId: userId, meta: { revoked } });
      res.json({ revoked });
    },

    async acceptTerms(req: Request, res: Response) {
      const { userId } = authOf(res);
      const { termsVersion } = termsBody.parse(req.body);
      auth.assertCurrentTerms(termsVersion);
      await usersRepo.update(userId, { "terms.version": termsVersion, "terms.acceptedAt": new Date(deps.now()) });
      await audit(metaOf(req, res), { action: "terms.accept", outcome: "success", actorId: userId, meta: { version: termsVersion } });
      const user = await usersRepo.findById(userId);
      if (!user) throw errors.notFound();
      res.json(auth.toPublic(user));
    },

    async mfaSetup(_req: Request, res: Response) {
      res.setHeader("Cache-Control", "no-store");
      res.json(await mfa.setup(authOf(res).userId));
    },

    async mfaEnable(req: Request, res: Response) {
      res.setHeader("Cache-Control", "no-store");
      res.json(await mfa.enable(authOf(res).userId, totpBody.parse(req.body).code, metaOf(req, res)));
    },

    async mfaDisable(req: Request, res: Response) {
      await mfa.disable(authOf(res).userId, mfaDisableBody.parse(req.body), metaOf(req, res));
      res.status(204).end();
    },
  };
}
