import type { Types } from "mongoose";
import type { AppDeps, RequestMeta } from "../context.js";
import { auditRepo } from "../repositories/index.js";

const DAY_MS = 86_400_000;

export interface AuditEntry {
  action: string;
  outcome: "success" | "failure";
  actorId?: Types.ObjectId | null;
  targetId?: string | null;
  meta?: Record<string, string | number | boolean>;
}

export type Auditor = (meta: RequestMeta, entry: AuditEntry) => Promise<void>;

/** Nunca guarda PII en claro: la IP se pseudonimiza con HMAC. Un fallo de auditoría se registra y no tumba la petición. */
export function createAuditor(deps: Pick<AppDeps, "cipher" | "logger" | "now" | "env">): Auditor {
  return async (meta, entry) => {
    const at = new Date(deps.now());
    try {
      await auditRepo.insert({
        at,
        action: entry.action,
        outcome: entry.outcome,
        actorId: entry.actorId ?? null,
        targetId: entry.targetId ?? null,
        requestId: meta.requestId,
        ipIndex: meta.ip ? deps.cipher.blindIndex(meta.ip) : "",
        meta: entry.meta ?? {},
        expiresAt: new Date(at.getTime() + deps.env.API_AUDIT_RETENTION_DAYS * DAY_MS),
      });
    } catch (err) {
      deps.logger.error({ err: (err as Error).message, action: entry.action, requestId: meta.requestId }, "audit write failed");
    }
  };
}
