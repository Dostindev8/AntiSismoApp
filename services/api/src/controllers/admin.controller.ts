import type { Request, Response } from "express";
import { errors } from "../lib/errors.js";
import { authOf } from "../middleware/auth.js";
import { metaOf } from "../middleware/security.js";
import { auditRepo, toObjectId, usersRepo } from "../repositories/index.js";
import type { Auditor } from "../services/audit.service.js";
import { auditQuery, idParam, rolesBody } from "./schemas.js";

export function createAdminController(audit: Auditor) {
  return {
    async listAudit(req: Request, res: Response) {
      const { limit } = auditQuery.parse(req.query);
      const entries = await auditRepo.list(limit);
      res.json({
        entries: entries.map((e) => ({
          id: String(e._id),
          at: e.at.getTime(),
          action: e.action,
          outcome: e.outcome,
          actorId: e.actorId ? String(e.actorId) : null,
          targetId: e.targetId ?? null,
          requestId: e.requestId,
          meta: e.meta,
        })),
      });
    },

    async setRoles(req: Request, res: Response) {
      const actor = authOf(res);
      const id = toObjectId(idParam.parse(req.params).id);
      const { roles } = rolesBody.parse(req.body);
      if (!id) throw errors.notFound();
      if (id.equals(actor.userId) && !roles.includes("platform_admin")) {
        throw errors.conflict("SELF_DEMOTION", "Administrators cannot remove their own admin role");
      }
      if (!(await usersRepo.setRoles(id, [...new Set(roles)]))) throw errors.notFound();
      await audit(metaOf(req, res), { action: "admin.roles.update", outcome: "success", actorId: actor.userId, targetId: String(id), meta: { roles: roles.join(",") } });
      res.status(204).end();
    },
  };
}
