import { describe, expect, it } from "vitest";

import { apiRewrites, parseEnv } from "./env";

describe("parseEnv", () => {
  it("acepta el entorno mínimo de desarrollo", () => {
    expect(parseEnv({ NODE_ENV: "development" })).toEqual({ NODE_ENV: "development" });
  });

  it("rechaza una API http en producción", () => {
    expect(() => parseEnv({ NODE_ENV: "production", NEXT_PUBLIC_API_ORIGIN: "http://api.example.com" })).toThrow();
  });

  it("acepta https en producción y trata vacío como ausente", () => {
    expect(parseEnv({ NODE_ENV: "production", NEXT_PUBLIC_API_ORIGIN: "https://api.example.com" }).NEXT_PUBLIC_API_ORIGIN).toBe(
      "https://api.example.com",
    );
    expect(parseEnv({ NODE_ENV: "production", NEXT_PUBLIC_API_ORIGIN: "" }).NEXT_PUBLIC_API_ORIGIN).toBeUndefined();
  });

  it("API_INTERNAL_ORIGIN: https obligatorio en producción, sin barra final y reescritura same-origin", () => {
    expect(() => parseEnv({ NODE_ENV: "production", API_INTERNAL_ORIGIN: "http://api.internal" })).toThrow();
    expect(() => parseEnv({ NODE_ENV: "production", API_INTERNAL_ORIGIN: "http://127.0.0.1.evil.com" })).toThrow();
    expect(parseEnv({ NODE_ENV: "production", API_INTERNAL_ORIGIN: "http://127.0.0.1:8080" }).API_INTERNAL_ORIGIN).toBe("http://127.0.0.1:8080");
    const e = parseEnv({ NODE_ENV: "production", API_INTERNAL_ORIGIN: "https://api.example.com/" });
    expect(e.API_INTERNAL_ORIGIN).toBe("https://api.example.com");
    expect(apiRewrites(e)).toEqual([{ source: "/api/v1/:path*", destination: "https://api.example.com/v1/:path*" }]);
    expect(parseEnv({ NODE_ENV: "development", API_INTERNAL_ORIGIN: "http://127.0.0.1:8080" }).API_INTERNAL_ORIGIN).toBe("http://127.0.0.1:8080");
  });

  it("sin API configurado no hay reescritura (la UI muestra estado degradado)", () => {
    expect(apiRewrites(parseEnv({ NODE_ENV: "production", API_INTERNAL_ORIGIN: "" }))).toEqual([]);
    expect(() => parseEnv({ NODE_ENV: "development", API_INTERNAL_ORIGIN: "file:///etc/passwd" })).toThrow();
  });

  it("rechaza esquemas que no son http(s) y valores que no son URL", () => {
    expect(() => parseEnv({ NODE_ENV: "development", NEXT_PUBLIC_API_ORIGIN: "javascript:alert(1)" })).toThrow();
    expect(() => parseEnv({ NODE_ENV: "development", NEXT_PUBLIC_API_ORIGIN: "no es url" })).toThrow();
  });
});
