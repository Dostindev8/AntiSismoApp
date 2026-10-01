import { describe, expect, it } from "vitest";
import tokens from "../tokens.json" with { type: "json" };
import { contrastRatio, parseHex } from "./contrast.js";

const colors = tokens.colors as Record<string, string>;
const hex = (name: string): string => {
  const v = colors[name];
  if (!v) throw new Error(`Unknown token: ${name}`);
  return v;
};

describe("design tokens", () => {
  it("every token is a valid #RRGGBB", () => {
    for (const v of Object.values(colors)) expect(() => parseHex(v)).not.toThrow();
    for (const h of Object.values(tokens.hazards)) expect(() => parseHex(h.color)).not.toThrow();
  });

  it("hazards use 7 distinct icons (color is never the only cue)", () => {
    const icons = Object.values(tokens.hazards).map((h) => h.icon);
    expect(new Set(icons).size).toBe(icons.length);
    expect(icons).toHaveLength(7);
  });

  describe.each(tokens.contrastRules.pairs)("contrast $fg on $bg ($use)", (pair) => {
    const ratio = contrastRatio(hex(pair.fg), hex(pair.bg));
    it(`meets WCAG minimum ${pair.min}:1`, () => {
      expect(ratio).toBeGreaterThanOrEqual(pair.min);
    });
    if ("documented" in pair && typeof pair.documented === "number") {
      const documented = pair.documented;
      it(`matches documented ${documented}:1`, () => {
        expect(Math.abs(ratio - documented)).toBeLessThanOrEqual(0.01);
      });
    }
  });

  describe.each(tokens.contrastRules.forbidden)("forbidden $fg on $bg", (pair) => {
    const ratio = contrastRatio(hex(pair.fg), hex(pair.bg));
    it("really fails AA normal text (keeps the ban justified)", () => {
      expect(ratio).toBeLessThan(4.5);
      expect(Math.abs(ratio - pair.documented)).toBeLessThanOrEqual(0.01);
    });
  });
});
