import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { z } from "zod";

const hostname = z
  .string()
  .regex(/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, "invalid hostname");

const threshold = z
  .object({
    minMagnitude: z.number().min(0).max(10),
    maxDistanceKm: z.number().positive().max(20000),
    minExpectedMMI: z.number().min(1).max(12),
  })
  .strict();

const disabledSource = z.object({ enabled: z.literal(false), note: z.string().min(10) }).strict();

const usgsSource = z
  .object({
    enabled: z.boolean(),
    host: hostname,
    pollSeconds: z.number().int().min(30, "USGS feeds refresh ~1/min: poll >= 30s (§3#15)"),
    feeds: z.array(z.enum(["all_hour", "significant_week", "all_day", "significant_day"])).min(1),
  })
  .strict();

const emscSource = z
  .object({
    enabled: z.boolean(),
    host: hostname,
    websocket: z.boolean(),
    backoff: z
      .object({ baseMs: z.number().int().positive(), maxMs: z.number().int().positive(), jitter: z.literal(true) })
      .strict()
      .refine((b) => b.maxMs >= b.baseMs, "backoff.maxMs < baseMs"),
  })
  .strict();

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const RegionConfigSchema = z
  .object({
    region: z.string().regex(/^[A-Z]{2}$/),
    name: z.string().min(2),
    timezone: z.string().refine(isValidTimeZone, "invalid IANA timezone"),
    locale: z.string().regex(/^[a-z]{2}-[A-Z]{2}$/),
    emergencyNumber: z.string().regex(/^\d{3,4}$/),
    bbox: z
      .object({
        minLat: z.number().min(-90).max(90),
        maxLat: z.number().min(-90).max(90),
        minLon: z.number().min(-180).max(180),
        maxLon: z.number().min(-180).max(180),
      })
      .strict()
      .refine((b) => b.minLat < b.maxLat && b.minLon < b.maxLon, "bbox min must be < max"),
    thresholds: z.object({ critical: threshold, informative: threshold }).strict(),
    tsunami: z.object({ forceCriticalOnFlag: z.boolean() }).strict(),
    sources: z
      .object({ usgs: usgsSource, emsc: emscSource })
      .catchall(disabledSource),
    dedup: z
      .object({
        windowMs: z.number().int().positive().max(60_000),
        radiusKm: z.number().positive().max(500),
        maxDeltaMag: z.number().positive().max(3),
      })
      .strict(),
    ops: z
      .object({
        primarySource: z.enum(["usgs", "emsc"]),
        sourceDownAlarmSeconds: z.number().int().min(10).max(600),
      })
      .strict(),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (!c.sources[c.ops.primarySource].enabled)
      ctx.addIssue({ code: "custom", message: "ops.primarySource must be an enabled source" });
    const { critical, informative } = c.thresholds;
    if (critical.minMagnitude < informative.minMagnitude)
      ctx.addIssue({ code: "custom", message: "critical.minMagnitude must be >= informative.minMagnitude" });
    if (critical.maxDistanceKm > informative.maxDistanceKm)
      ctx.addIssue({ code: "custom", message: "critical.maxDistanceKm must be <= informative.maxDistanceKm" });
    if (critical.minExpectedMMI < 5)
      ctx.addIssue({ code: "custom", message: "CRITICAL requires expected MMI >= V (§3#17)" });
  });

export type RegionConfig = z.infer<typeof RegionConfigSchema>;

const regionsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "regions");

export function listRegions(): string[] {
  return readdirSync(regionsDir)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => f.replace(/\.yaml$/, ""))
    .sort();
}

export function loadRegion(code: string): RegionConfig {
  if (!/^[A-Z]{2}$/.test(code)) throw new Error(`Invalid region code: ${code}`);
  const raw: unknown = parse(readFileSync(join(regionsDir, `${code}.yaml`), "utf8"));
  const cfg = RegionConfigSchema.parse(raw);
  if (cfg.region !== code) throw new Error(`Region file ${code}.yaml declares region ${cfg.region}`);
  return cfg;
}

/** Hosts permitidos para ingesta (allowlist anti-SSRF, §8.1). Solo fuentes habilitadas con host. */
export function allowedHosts(cfg: RegionConfig): string[] {
  return [cfg.sources.usgs, cfg.sources.emsc].filter((s) => s.enabled).map((s) => s.host);
}
