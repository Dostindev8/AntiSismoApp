import { describe, expect, it } from "vitest";

import { parseEnv } from "./env";

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

  it("rechaza esquemas que no son http(s) y valores que no son URL", () => {
    expect(() => parseEnv({ NODE_ENV: "development", NEXT_PUBLIC_API_ORIGIN: "javascript:alert(1)" })).toThrow();
    expect(() => parseEnv({ NODE_ENV: "development", NEXT_PUBLIC_API_ORIGIN: "no es url" })).toThrow();
  });
});
