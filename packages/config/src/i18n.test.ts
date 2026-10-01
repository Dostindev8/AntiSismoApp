import { describe, expect, it } from "vitest";
import { BASE_LOCALE, format, listLocales, loadMessages, loadRaw, placeholders } from "./i18n.js";

const SPANISH_LOCALES = ["es-AR", "es-CL", "es-DO", "es-ES", "es-MX", "es-PE"];
const REQUIRED_LOCALES = [...SPANISH_LOCALES, "en"];

/** Typos detectados en el Blueprint (§3#12) + palabras que nunca deben aparecer en texto crítico. */
const FORBIDDEN_SUBSTRINGS = [/\balejate\b/i, /segurura/i, /\bagachate\b/i];

describe("i18n", () => {
  const base = loadRaw(BASE_LOCALE);

  it("ships every required locale", () => {
    expect(listLocales()).toEqual(expect.arrayContaining(REQUIRED_LOCALES));
  });

  it.each(REQUIRED_LOCALES.filter((l) => l !== BASE_LOCALE))("%s only overrides existing base keys with same placeholders", (loc) => {
    const raw = loadRaw(loc);
    for (const [k, v] of Object.entries(raw)) {
      expect(base, `unknown key ${k} in ${loc}`).toHaveProperty(k);
      expect(placeholders(v), `placeholder mismatch ${loc}:${k}`).toEqual(placeholders(base[k]!));
    }
  });

  it("en is complete: translates every base key (no Spanish fallback on screen)", () => {
    const en = loadRaw("en");
    const missing = Object.keys(base).filter((k) => !(k in en));
    expect(missing).toEqual([]);
    for (const k of ["app.tagline", "alert.arrival", "emergency.disclaimer", "instruction.DROP_COVER_HOLD_ON"]) {
      expect(en[k], k).not.toBe(base[k]);
    }
  });

  it.each(REQUIRED_LOCALES)("%s has no empty strings, no known typos, no raw HTML", (loc) => {
    for (const [k, v] of Object.entries(loadMessages(loc))) {
      expect(v.trim(), k).not.toBe("");
      expect(v, k).not.toMatch(/[<>]/);
      // es-AR usa voseo sin tilde ("agachate") de forma correcta; el resto exige "Agáchate".
      const patterns = loc === "es-AR" ? FORBIDDEN_SUBSTRINGS.slice(0, 2) : FORBIDDEN_SUBSTRINGS;
      for (const p of patterns) expect(v, `${loc}:${k}`).not.toMatch(p);
    }
  });

  it("UI label uses «Llegada estimada»; «arribo» only allowed in voice phrases (§3#11)", () => {
    expect(base["alert.arrival"]).toBe("Llegada estimada");
    for (const [k, v] of Object.entries(base)) {
      if (!k.startsWith("voice.")) expect(v, k).not.toMatch(/arribo/i);
    }
  });

  it("critical voice follows the exact template (SUPER-PROMPT v3.0 §F5)", () => {
    expect(base["voice.critical"]).toBe(
      "{name}, esto no es un simulacro. Favor tomar las acciones correspondientes. {instruction}. Tiempo estimado de arribo: {seconds} segundos.",
    );
    expect(placeholders(base["voice.criticalNoTime"]!)).toEqual(["instruction", "name"]);
    expect(placeholders(base["voice.criticalAnon"]!)).toEqual(["instruction", "seconds"]);
  });

  it.each(SPANISH_LOCALES)("%s: drill voice says «Esto es un simulacro.»; critical voices say «no es un simulacro» (§3#13)", (loc) => {
    const m = loadMessages(loc);
    expect(m["voice.drill"]).toMatch(/^Esto es un simulacro\./);
    expect(m["voice.drillAnon"]).toMatch(/^Esto es un simulacro\./);
    for (const k of ["voice.critical", "voice.criticalNoTime", "voice.criticalAnon", "voice.criticalAnonNoTime"]) {
      expect(m[k], k).toMatch(/esto no es un simulacro\./i);
      expect(m[k], k).not.toMatch(/^Esto es un simulacro/);
    }
  });

  it("en: drill voice says «This is a drill.»; critical voices say «this is not a drill»", () => {
    const m = loadMessages("en");
    expect(m["voice.drill"]).toMatch(/^This is a drill\./);
    expect(m["voice.drillAnon"]).toMatch(/^This is a drill\./);
    for (const k of ["voice.critical", "voice.criticalNoTime", "voice.criticalAnon", "voice.criticalAnonNoTime"]) {
      expect(m[k], k).toMatch(/this is not a drill\./i);
    }
  });

  it("emergency disclaimer is present and exact (F5B)", () => {
    expect(base["emergency.disclaimer"]).toBe("AntiSismo no reemplaza a los servicios oficiales de emergencia");
  });

  it("honesty notice states the app amplifies (not replaces) official alerts (§0.5)", () => {
    expect(base["honesty.body"]).toMatch(/no las reemplaza/);
    expect(base["honesty.body"]).toMatch(/cero fallas/);
  });

  it("format() substitutes params and fails loudly on missing ones", () => {
    expect(format(base["sos.call"]!, { emergencyNumber: "911" })).toBe("Llamar al 911");
    expect(() => format(base["voice.critical"]!, { name: "Ana", instruction: "x" })).toThrow(/seconds/);
  });

  it("rejects malformed locale identifiers (path traversal)", () => {
    expect(() => loadRaw("../es-DO")).toThrow(/Invalid locale/);
    expect(() => loadRaw("EN")).toThrow(/Invalid locale/);
  });
});
