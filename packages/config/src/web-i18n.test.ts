import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = join(import.meta.dirname, "..", "i18n", "web");
const REQUIRED = ["es-DO", "en", "fr", "pt"];

type Tree = { [k: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.set(key, v);
    else for (const [ck, cv] of flatten(v, key)) out.set(ck, cv);
  }
  return out;
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const load = (loc: string) => flatten(JSON.parse(readFileSync(join(dir, `${loc}.json`), "utf8")) as Tree);

describe("mensajes web (next-intl)", () => {
  const base = load("es-DO");

  it("incluye todos los idiomas obligatorios y ninguno desconocido", () => {
    const found = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();
    expect(found).toEqual([...REQUIRED].sort());
  });

  it.each(REQUIRED)("%s tiene exactamente las claves de es-DO, sin textos vacíos", (loc) => {
    const msgs = load(loc);
    expect([...msgs.keys()].sort()).toEqual([...base.keys()].sort());
    for (const [k, v] of msgs) expect(v.trim(), `${loc}:${k}`).not.toBe("");
  });

  it.each(REQUIRED)("%s conserva los mismos marcadores {x} que es-DO", (loc) => {
    const msgs = load(loc);
    for (const [k, v] of base) expect(placeholders(msgs.get(k) ?? ""), `${loc}:${k}`).toEqual(placeholders(v));
  });

  it("es-DO no contiene erratas conocidas del mockup", () => {
    const all = [...base.values()].join("\n");
    for (const bad of ["tucorroe", "politica ", "contraseña? contraseña?", "Porto Plata", "Dominicano\n"]) {
      expect(all).not.toContain(bad);
    }
  });
});
