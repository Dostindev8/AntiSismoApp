/**
 * Genera fixtures/alert-vectors.json con claves Ed25519 EFÍMERAS (la clave privada nunca se escribe a disco).
 * Los kids "k-test-*" solo existen en fixtures: el keyset de producción nunca los incluye.
 * Uso: pnpm --filter @antisismo/proto gen:fixtures
 */
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalString, computeAlertId, type SignedAlert } from "../src/index.js";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "alert-vectors.json");

function keypair(): { priv: KeyObject; pubB64u: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const der = publicKey.export({ format: "der", type: "spki" });
  return { priv: privateKey, pubB64u: der.subarray(der.length - 32).toString("base64url") };
}

const active = keypair();
const next = keypair();
const rogue = keypair();

const EVENT_ID = "3f6c2a1e-8b4d-4c1a-9e2f-7a5b6c8d9e01";
const IAT = 1_790_627_529_000;
const EXP = 1_790_627_829_000;

type Unsigned = Omit<SignedAlert, "sig">;

function base(overrides: Partial<Unsigned> = {}, rev = 0): Unsigned {
  return {
    v: 1,
    alert_id: computeAlertId(EVENT_ID, rev),
    level: "CRITICAL",
    event: {
      id: EVENT_ID,
      type: "EARTHQUAKE",
      magnitude: 6.8,
      mag_type: "Mw",
      time_utc_ms: 1_790_627_527_000,
      place: "Frente a la costa norte de República Dominicana",
      lon: -69.9,
      lat: 19.7,
      depth_km: 35,
      mmi_estimated_regional: 6,
      mmi_range: [5, 7],
      tsunami: false,
      solution_status: "automatic",
      revision_seq: rev,
      tea_regional_seconds: 12,
    },
    instruction: "DROP_COVER_HOLD_ON",
    voice: { speak_name: true },
    iat_ms: IAT,
    exp_ms: EXP,
    server_time_ms: 1_790_627_529_100,
    kid: "k-test-active",
    ...overrides,
  };
}

function signWith(u: Unsigned, priv: KeyObject): SignedAlert {
  return { ...u, sig: sign(null, Buffer.from(canonicalString(u), "utf8"), priv).toString("base64url") };
}

const valid = signWith(base(), active.priv);

const cases: { name: string; now_ms: number; expect: string; alert: unknown }[] = [
  { name: "valid-critical", now_ms: IAT + 1000, expect: "ALARM", alert: valid },
  { name: "valid-critical-at-exp-boundary", now_ms: EXP, expect: "ALARM", alert: valid },
  { name: "expired-becomes-informative (QA-14)", now_ms: EXP + 1, expect: "INFORMATIVE", alert: valid },
  { name: "informative-level", now_ms: IAT + 1000, expect: "INFORMATIVE", alert: signWith(base({ level: "INFORMATIVE" }), active.priv) },
  { name: "drill-never-critical (QA-23)", now_ms: IAT + 1000, expect: "DRILL", alert: signWith(base({ level: "DRILL" }), active.priv) },
  { name: "drill-tampered-to-critical", now_ms: IAT + 1000, expect: "RECONCILE", alert: { ...signWith(base({ level: "DRILL" }), active.priv), level: "CRITICAL" } },
  { name: "informative-tampered-to-critical", now_ms: IAT + 1000, expect: "RECONCILE", alert: { ...signWith(base({ level: "INFORMATIVE" }), active.priv), level: "CRITICAL" } },
  { name: "instruction-tampered", now_ms: IAT + 1000, expect: "RECONCILE", alert: { ...valid, instruction: "FOLLOW_AUTHORITIES" } },
  { name: "exp-extended-replay (QA-14)", now_ms: EXP + 60_000, expect: "RECONCILE", alert: { ...valid, exp_ms: EXP + 120_000 } },
  { name: "rogue-key-invalid-signature (QA-13)", now_ms: IAT + 1000, expect: "RECONCILE", alert: signWith(base(), rogue.priv) },
  { name: "unknown-kid", now_ms: IAT + 1000, expect: "RECONCILE", alert: signWith(base({ kid: "k-unknown" }), active.priv) },
  { name: "next-key-rotation", now_ms: IAT + 1000, expect: "ALARM", alert: signWith(base({ kid: "k-test-next" }), next.priv) },
  { name: "alert-id-mismatch-even-if-signed", now_ms: IAT + 1000, expect: "RECONCILE", alert: signWith(base({ alert_id: "0".repeat(64) }), active.priv) },
  { name: "validity-window-too-long", now_ms: IAT + 1000, expect: "RECONCILE", alert: signWith(base({ exp_ms: IAT + 11 * 60_000 }), active.priv) },
  { name: "validity-window-inverted", now_ms: IAT + 1000, expect: "RECONCILE", alert: signWith(base({ exp_ms: IAT - 1 }), active.priv) },
  { name: "revision-2-valid", now_ms: IAT + 1000, expect: "ALARM", alert: signWith(base({}, 2), active.priv) },
  { name: "malformed-missing-sig", now_ms: IAT + 1000, expect: "RECONCILE", alert: base() },
  { name: "malformed-html-place", now_ms: IAT + 1000, expect: "RECONCILE", alert: { ...valid, event: { ...valid.event, place: "<img src=x onerror=alert(1)>" } } },
  { name: "malformed-extra-field", now_ms: IAT + 1000, expect: "RECONCILE", alert: { ...valid, debug: true } },
];

const doc = {
  $comment: "GENERADO por scripts/gen-alert-vectors.ts — no editar a mano. Claves efímeras de prueba (kid k-test-*); nunca en producción.",
  canonical: {
    event_id: EVENT_ID,
    revision_seq: 0,
    alert_id: computeAlertId(EVENT_ID, 0),
    string: canonicalString(valid),
  },
  public_keys: { "k-test-active": active.pubB64u, "k-test-next": next.pubB64u },
  cases,
};

writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
console.log(`wrote ${cases.length} alert vectors → ${out}`);
