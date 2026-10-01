import { describe, expect, it } from "vitest";
import { RegionConfigSchema, allowedHosts, listRegions, loadRegion } from "./region.js";

describe("region config", () => {
  it("DO is present and is the initial market (§1)", () => {
    const d = loadRegion("DO");
    expect(d.timezone).toBe("America/Santo_Domingo");
    expect(d.locale).toBe("es-DO");
    expect(d.emergencyNumber).toBe("911");
  });

  it.each(listRegions())("%s validates against schema and invariants", (code) => {
    const cfg = loadRegion(code);
    expect(cfg.thresholds.critical.minExpectedMMI).toBeGreaterThanOrEqual(5);
    expect(cfg.sources.usgs.pollSeconds).toBeGreaterThanOrEqual(30);
    expect(cfg.dedup).toEqual({ windowMs: 16000, radiusKm: 100, maxDeltaMag: 1.5 });
  });

  it("unverified official sources stay disabled (§3#18: never invent endpoints)", () => {
    for (const code of listRegions()) {
      const { usgs, emsc, ...rest } = loadRegion(code).sources;
      void usgs;
      void emsc;
      for (const [name, src] of Object.entries(rest)) expect(src.enabled, `${code}.${name}`).toBe(false);
    }
  });

  it("ingest allowlist contains only enabled source hosts", () => {
    expect(allowedHosts(loadRegion("DO")).sort()).toEqual(["earthquake.usgs.gov", "www.seismicportal.eu"]);
  });

  it("rejects dangerous configs", () => {
    const good = loadRegion("DO");
    const bad = (patch: (c: Record<string, unknown>) => void) => {
      const c = structuredClone(good) as unknown as Record<string, unknown>;
      patch(c);
      return RegionConfigSchema.safeParse(c).success;
    };
    expect(bad(() => {})).toBe(true);
    expect(bad((c) => ((c["timezone"] as unknown) = "Mars/Olympus"))).toBe(false);
    expect(bad((c) => ((c["thresholds"] as { critical: { minExpectedMMI: number } }).critical.minExpectedMMI = 4))).toBe(false);
    expect(bad((c) => ((c["sources"] as { usgs: { pollSeconds: number } }).usgs.pollSeconds = 5))).toBe(false);
    expect(bad((c) => ((c["sources"] as { usgs: { host: string } }).usgs.host = "http://169.254.169.254/"))).toBe(false);
    expect(bad((c) => ((c["sources"] as Record<string, unknown>)["cns_do"] = { enabled: true, note: "sin verificar aún" }))).toBe(false);
    expect(bad((c) => ((c["bbox"] as { minLat: number }).minLat = 30))).toBe(false);
    expect(bad((c) => ((c["sources"] as { usgs: { enabled: boolean } }).usgs.enabled = false))).toBe(false);
    expect(bad((c) => ((c["ops"] as { sourceDownAlarmSeconds: number }).sourceDownAlarmSeconds = 3600))).toBe(false);
  });

  it("primary source is USGS with a 60 s outage alarm (F2 residual)", () => {
    for (const code of listRegions()) expect(loadRegion(code).ops).toEqual({ primarySource: "usgs", sourceDownAlarmSeconds: 60 });
  });
});
