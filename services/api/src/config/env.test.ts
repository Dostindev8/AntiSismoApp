import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.js";

describe("env", () => {
  it("valores por defecto seguros en desarrollo", () => {
    const env = parseEnv({});
    expect(env.API_PASSWORD_MIN).toBe(12);
    expect(env.API_CORS_ORIGINS).toEqual(["http://localhost:3000"]);
    expect(env.API_HIBP_ENABLED).toBe(true);
  });

  it("no permite bajar el mínimo de contraseña de 12", () => {
    expect(() => parseEnv({ API_PASSWORD_MIN: "8" })).toThrow();
  });

  it("producción exige Mongo, claves y https en todos los orígenes", () => {
    expect(() => parseEnv({ NODE_ENV: "production" })).toThrow(/API_MONGO_URI/);
    const ok = {
      NODE_ENV: "production",
      API_MONGO_URI: "mongodb://db/antisismo",
      API_JWT_PRIVATE_KEY_PATH: "/run/secrets/jwt.key",
      API_JWT_PUBLIC_KEY_PATH: "/run/secrets/jwt.pub",
      API_FIELD_KEY_B64: "x".repeat(44),
      API_PUBLIC_ORIGIN: "https://api.antisismo.app",
      API_WEB_ORIGIN: "https://antisismo.app",
      API_CORS_ORIGINS: "https://antisismo.app",
    };
    expect(parseEnv(ok).NODE_ENV).toBe("production");
    expect(() => parseEnv({ ...ok, API_CORS_ORIGINS: "http://antisismo.app" })).toThrow(/https/);
    expect(() => parseEnv({ ...ok, API_WEB_ORIGIN: "http://antisismo.app" })).toThrow(/https/);
  });

  it("rechaza orígenes CORS que no son URL http(s)", () => {
    expect(() => parseEnv({ API_CORS_ORIGINS: "javascript:alert(1)" })).toThrow();
  });
});
