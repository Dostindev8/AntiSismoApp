import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { describe, expect, it } from "vitest";
import {
  NormalizedEventSchema,
  SignedAlertSchema,
  canonicalString,
  classifyIncomingAlert,
  computeAlertId,
  verifySignature,
} from "./index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (p: string): unknown => JSON.parse(readFileSync(join(root, p), "utf8"));

type EventFixtures = { valid: { name: string; event: unknown }[]; invalid: { name: string; reason: string; event: unknown }[] };
type AlertVectors = {
  canonical: { event_id: string; revision_seq: number; alert_id: string; string: string };
  public_keys: Record<string, string>;
  cases: { name: string; now_ms: number; expect: string; alert: unknown }[];
};

const events = readJson("fixtures/events.json") as EventFixtures;
const vectors = readJson("fixtures/alert-vectors.json") as AlertVectors;

const addFormats = addFormatsModule as unknown as (ajv: Ajv2020) => Ajv2020;
const ajv = addFormats(new Ajv2020({ strict: true, allErrors: true }));
const validateEventSchema = ajv.compile(readJson("schemas/normalized-event.schema.json") as object);
const validateAlertSchema = ajv.compile(readJson("schemas/signed-alert.schema.json") as object);
const validateErrorSchema = ajv.compile(readJson("schemas/api-error.schema.json") as object);

describe("epoch ↔ text (§3#1 errata)", () => {
  it("1790627527000 is Monday 2026-09-28 20:32:07 UTC", () => {
    const d = new Date(1_790_627_527_000);
    expect(d.toISOString()).toBe("2026-09-28T20:32:07.000Z");
    expect(d.getUTCDay()).toBe(1);
  });
  it("same instant is 16:32:07 in America/Santo_Domingo (UTC−4, no DST)", () => {
    const fmt = new Intl.DateTimeFormat("es-DO", {
      timeZone: "America/Santo_Domingo",
      weekday: "long", day: "numeric", month: "long", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    });
    const s = fmt.format(new Date(1_790_627_527_000));
    expect(s).toMatch(/lunes/);
    expect(s).toMatch(/28/);
    expect(s).toMatch(/septiembre/);
    expect(s).toMatch(/16:32:07/);
  });
  it("the Blueprint's wrong epoch 1786613527000 is 13-Aug-2026 (kept as regression guard)", () => {
    expect(new Date(1_786_613_527_000).toISOString()).toBe("2026-08-13T09:32:07.000Z");
  });
});

describe("NormalizedEvent contract", () => {
  it.each(events.valid.map((v) => [v.name, v.event] as const))("valid: %s passes JSON Schema and zod", (_n, ev) => {
    expect(validateEventSchema(ev), JSON.stringify(validateEventSchema.errors)).toBe(true);
    expect(NormalizedEventSchema.safeParse(ev).success).toBe(true);
  });
  it.each(events.invalid.map((v) => [v.name, v.event] as const))("invalid: %s rejected by full validation", (_n, ev) => {
    expect(NormalizedEventSchema.safeParse(ev).success).toBe(false);
  });
  it("place-too-long fixture is exactly 201 chars (boundary)", () => {
    const f = events.invalid.find((x) => x.name === "place-too-long")!.event as { place: string };
    expect(f.place.length).toBe(201);
  });
  it("schema and zod agree on every schema-level invalid fixture", () => {
    const semanticOnly = new Set(["future-over-5-min"]);
    for (const f of events.invalid) {
      if (semanticOnly.has(f.name)) continue;
      expect(validateEventSchema(f.event), f.name).toBe(false);
    }
  });
});

describe("SignedAlert contract + Ed25519", () => {
  it("alert_id = sha256(event.id:revision_seq)", () => {
    expect(computeAlertId(vectors.canonical.event_id, vectors.canonical.revision_seq)).toBe(vectors.canonical.alert_id);
    expect(computeAlertId(vectors.canonical.event_id, 1)).not.toBe(vectors.canonical.alert_id);
  });

  it("canonical string layout is the fixed v1 contract", () => {
    const lines = vectors.canonical.string.split("\n");
    expect(lines).toHaveLength(9);
    expect(lines[0]).toBe("v1");
    expect(lines[1]).toBe(vectors.canonical.alert_id);
    expect(lines[7]).toBe("CRITICAL");
  });

  it("valid vector passes JSON Schema + zod, is < 4 KB and verifies", () => {
    const valid = vectors.cases.find((c) => c.name === "valid-critical")!.alert;
    expect(validateAlertSchema(valid), JSON.stringify(validateAlertSchema.errors)).toBe(true);
    const a = SignedAlertSchema.parse(valid);
    expect(canonicalString(a)).toBe(vectors.canonical.string);
    expect(verifySignature(a, vectors.public_keys)).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(valid), "utf8")).toBeLessThan(4096);
  });

  it.each(vectors.cases.map((c) => [c.name, c] as const))("decision: %s", (_n, c) => {
    expect(classifyIncomingAlert(c.alert, c.now_ms, vectors.public_keys).action).toBe(c.expect);
  });

  it("vectors cover every action", () => {
    expect(new Set(vectors.cases.map((c) => c.expect))).toEqual(new Set(["ALARM", "INFORMATIVE", "DRILL", "RECONCILE"]));
  });
});

describe("ApiError contract", () => {
  it("accepts the standard shape and rejects leaks", () => {
    expect(validateErrorSchema({ error: { code: "RATE_LIMITED", message: "Demasiadas solicitudes", degraded: false, retry_after_ms: 1000 } })).toBe(true);
    expect(validateErrorSchema({ error: { code: "X", message: "m", degraded: false } })).toBe(false);
    expect(validateErrorSchema({ error: { code: "INTERNAL", message: "m", degraded: true, stack: "at foo()" } })).toBe(false);
  });
});
