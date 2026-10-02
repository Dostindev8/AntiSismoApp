import { describe, expect, it } from "vitest";

import { buildCsp, staticSecurityHeaders } from "./security-headers";

const nonce = "dGVzdC1ub25jZS0xMjM0NTY=";

describe("buildCsp", () => {
  it("producción: nonce + strict-dynamic, sin unsafe-inline ni unsafe-eval en scripts", () => {
    const csp = buildCsp({ nonce, dev: false });
    const script = csp.split("; ").find((d) => d.startsWith("script-src "));
    expect(script).toBe(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("upgrade-insecure-requests");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  it("desarrollo: permite eval y ws: solo para el recargado en caliente", () => {
    const csp = buildCsp({ nonce, dev: true });
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("connect-src 'self' ws:");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });

  it("añade solo el origen de la API, nunca la ruta", () => {
    expect(buildCsp({ nonce, dev: false, apiOrigin: "https://api.antisismo.app/v1/x" })).toContain(
      "connect-src 'self' https://api.antisismo.app;",
    );
  });

  it("rechaza nonces que podrían inyectar directivas", () => {
    expect(() => buildCsp({ nonce: "abc'; script-src *", dev: false })).toThrow();
    expect(() => buildCsp({ nonce: "short", dev: false })).toThrow();
  });
});

describe("staticSecurityHeaders", () => {
  it("HSTS solo en producción", () => {
    expect(staticSecurityHeaders(false).some((h) => h.key === "Strict-Transport-Security")).toBe(false);
    expect(staticSecurityHeaders(true).find((h) => h.key === "Strict-Transport-Security")?.value).toContain("preload");
  });

  it("geolocalización solo para el propio origen", () => {
    expect(staticSecurityHeaders(true).find((h) => h.key === "Permissions-Policy")?.value).toContain(
      "geolocation=(self)",
    );
  });
});
