import { createHash, createPublicKey, verify as cryptoVerify } from "node:crypto";
import { z } from "zod";

/** 2000-01-01T00:00:00Z — cualquier valor menor casi seguro está en SEGUNDOS, no ms. */
export const MIN_EPOCH_MS = 946_684_800_000;
export const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
/** Ventana máxima iat→exp aceptada como alarma. */
export const MAX_ALARM_WINDOW_MS = 10 * 60 * 1000;

export const HAZARD_TYPES = ["EARTHQUAKE", "TSUNAMI", "VOLCANO", "FLOOD", "LANDSLIDE", "WILDFIRE", "CIVIL"] as const;
export const ALERT_LEVELS = ["CRITICAL", "INFORMATIVE", "DRILL"] as const;
export const INSTRUCTIONS = ["DROP_COVER_HOLD_ON", "EVACUATE_HIGH_GROUND", "FLOOD_MOVE_AWAY", "FOLLOW_AUTHORITIES"] as const;

const epochMs = z.number().int().min(MIN_EPOCH_MS).max(32_503_680_000_000);
const safePlace = z.string().max(200).regex(/^[^\u0000-\u001F\u007F<>]*$/, "unsafe characters in place");
const magType = z.string().regex(/^[A-Za-z_]{1,8}$/);
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, "invalid uuid");

export const NormalizedEventSchema = z
  .object({
    id: uuid,
    source_ids: z
      .record(z.string().regex(/^[a-z][a-z0-9_]{1,15}$/), z.string().min(1).max(64).regex(/^[A-Za-z0-9_.:-]+$/))
      .refine((r) => Object.keys(r).length >= 1, "at least one source id"),
    type: z.enum(HAZARD_TYPES),
    magnitude: z.number().min(-2).max(10),
    mag_type: magType,
    time_utc_ms: epochMs,
    received_at_ms: epochMs,
    lon: z.number().min(-180).max(180),
    lat: z.number().min(-90).max(90),
    depth_km: z.number().min(-100).max(1000),
    place: safePlace,
    tsunami: z.boolean(),
    solution_status: z.enum(["automatic", "reviewed"]),
    revision_seq: z.number().int().min(0).max(10_000),
  })
  .strict()
  .refine((e) => e.time_utc_ms <= e.received_at_ms + MAX_FUTURE_SKEW_MS, {
    message: "event time more than 5 min in the future",
    path: ["time_utc_ms"],
  });

export type NormalizedEvent = z.infer<typeof NormalizedEventSchema>;

const mmi = z.number().min(1).max(12);

export const SignedAlertSchema = z
  .object({
    v: z.literal(1),
    alert_id: z.string().regex(/^[0-9a-f]{64}$/),
    level: z.enum(ALERT_LEVELS),
    event: z
      .object({
        id: uuid,
        type: z.enum(HAZARD_TYPES),
        magnitude: z.number().min(-2).max(10),
        mag_type: magType,
        time_utc_ms: epochMs,
        place: safePlace,
        lon: z.number().min(-180).max(180),
        lat: z.number().min(-90).max(90),
        depth_km: z.number().min(-100).max(1000),
        mmi_estimated_regional: mmi.nullable(),
        mmi_range: z.tuple([mmi, mmi]).nullable(),
        tsunami: z.boolean(),
        solution_status: z.enum(["automatic", "reviewed"]),
        revision_seq: z.number().int().min(0).max(10_000),
        tea_regional_seconds: z.number().int().min(0).max(600).nullable(),
      })
      .strict(),
    instruction: z.enum(INSTRUCTIONS),
    voice: z.object({ speak_name: z.boolean() }).strict(),
    iat_ms: z.number().int().min(MIN_EPOCH_MS),
    exp_ms: z.number().int().min(MIN_EPOCH_MS),
    server_time_ms: z.number().int().min(MIN_EPOCH_MS),
    kid: z.string().regex(/^k-[a-z0-9-]{1,32}$/),
    sig: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
  })
  .strict();

export type SignedAlert = z.infer<typeof SignedAlertSchema>;

/** alert_id determinista = hex(sha256(event.id + ':' + revision_seq)). */
export function computeAlertId(eventId: string, revisionSeq: number): string {
  return createHash("sha256").update(`${eventId}:${revisionSeq}`, "utf8").digest("hex");
}

/** Cadena canónica v1 (contrato fijo §7.2). */
export function canonicalString(a: Pick<SignedAlert, "alert_id" | "level" | "instruction" | "iat_ms" | "exp_ms"> & {
  event: Pick<SignedAlert["event"], "id" | "revision_seq" | "time_utc_ms">;
}): string {
  return [
    "v1",
    a.alert_id,
    a.event.id,
    String(a.event.revision_seq),
    String(a.event.time_utc_ms),
    String(a.iat_ms),
    String(a.exp_ms),
    a.level,
    a.instruction,
  ].join("\n");
}

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function verifySignature(a: SignedAlert, publicKeysByKid: Readonly<Record<string, string>>): boolean {
  const pkB64 = publicKeysByKid[a.kid];
  if (!pkB64) return false;
  const raw = Buffer.from(pkB64, "base64url");
  if (raw.length !== 32) return false;
  const sig = Buffer.from(a.sig, "base64url");
  if (sig.length !== 64) return false;
  const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: "der", type: "spki" });
  return cryptoVerify(null, Buffer.from(canonicalString(a), "utf8"), key, sig);
}

/**
 * Decisión fail-safe del cliente ante un push (§7.2, §8.1):
 *  - ALARM         → canal crítico (sonido/voz/pantalla completa)
 *  - INFORMATIVE   → notificación normal sin alarma (incluye alertas vencidas)
 *  - DRILL         → canal de simulacro, jamás el crítico (§3#13)
 *  - RECONCILE     → NO alarmar por este push; registrar incidente y confirmar vía GET /v1/events (TLS).
 *                    Si el evento existe y es crítico, alarmar con la fuente autenticada.
 * `nowMs` debe venir corregido con el offset de reloj servidor↔dispositivo conocido.
 */
export type AlertAction = "ALARM" | "INFORMATIVE" | "DRILL" | "RECONCILE";

export function classifyIncomingAlert(
  input: unknown,
  nowMs: number,
  publicKeysByKid: Readonly<Record<string, string>>,
): { action: AlertAction; reason: string } {
  const parsed = SignedAlertSchema.safeParse(input);
  if (!parsed.success) return { action: "RECONCILE", reason: "schema" };
  const a = parsed.data;
  if (a.exp_ms <= a.iat_ms || a.exp_ms - a.iat_ms > MAX_ALARM_WINDOW_MS) return { action: "RECONCILE", reason: "validity-window" };
  if (computeAlertId(a.event.id, a.event.revision_seq) !== a.alert_id) return { action: "RECONCILE", reason: "alert-id" };
  if (!verifySignature(a, publicKeysByKid)) return { action: "RECONCILE", reason: "signature" };
  if (a.level === "DRILL") return { action: "DRILL", reason: "drill" };
  if (nowMs > a.exp_ms) return { action: "INFORMATIVE", reason: "expired" };
  if (a.level === "INFORMATIVE") return { action: "INFORMATIVE", reason: "level" };
  return { action: "ALARM", reason: "ok" };
}
