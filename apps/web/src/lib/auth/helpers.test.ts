import { describe, expect, it } from "vitest";

import { ApiError } from "../api/client";
import { describeUserAgent, errorKey, passwordStrength, safeNextPath, tokenFromHash } from "./helpers";

describe("safeNextPath bloquea redirecciones abiertas", () => {
  it.each([
    ["/account/sessions", "/account/sessions"],
    ["/en/account?tab=mfa#x", "/en/account?tab=mfa#x"],
  ])("acepta %s", (input, out) => expect(safeNextPath(input)).toBe(out));

  it.each([null, "", "//evil.example", "https://evil.example", "/\\evil.example", "javascript:alert(1)", "evil", "/a\u0000b", `/${"a".repeat(600)}`])(
    "rechaza %s",
    (input) => expect(safeNextPath(input)).toBe("/account"),
  );
});

describe("tokenFromHash", () => {
  const good = "A".repeat(43);
  it("lee el token del fragmento y valida su forma", () => {
    expect(tokenFromHash(`#token=${good}`)).toBe(good);
    expect(tokenFromHash("#token=<script>")).toBeNull();
    expect(tokenFromHash("#token=short")).toBeNull();
    expect(tokenFromHash("")).toBeNull();
  });
  it("lee otras claves acotadas (mfa, error)", () => {
    expect(tokenFromHash("#error=oauth", "error")).toBe("oauth");
    expect(tokenFromHash(`#mfa=${"x".repeat(5000)}`, "mfa")).toBeNull();
  });
});

describe("passwordStrength (orientativa; el servidor decide)", () => {
  it("menos de 12 caracteres no cumple la política", () => {
    const s = passwordStrength("Corta-11ch!", { min: 12 });
    expect(s.meetsPolicy).toBe(false);
    expect(s.issues).toContain("tooShort");
    expect(s.level).toBe(0);
  });
  it("frase larga y variada es fuerte", () => {
    const s = passwordStrength("Mi casa-segura 2026 en Santiago!", { min: 12 });
    expect(s.meetsPolicy).toBe(true);
    expect(s.level).toBe(4);
  });
  it("penaliza correo, repeticiones y palabras comunes", () => {
    expect(passwordStrength("ana.perez-Clave99!", { min: 12, email: "ana.perez@example.com" }).issues).toContain("containsEmail");
    expect(passwordStrength("aaaaaaaaaaaaaaaa", { min: 12 }).issues).toContain("repetitive");
    const common = passwordStrength("Password-2026-Seguro", { min: 12 });
    expect(common.issues).toContain("common");
    expect(common.level).toBeLessThanOrEqual(1);
  });
  it("respeta el máximo", () => {
    expect(passwordStrength("x".repeat(200), { min: 12, max: 128 }).meetsPolicy).toBe(false);
  });
});

describe("describeUserAgent", () => {
  it.each([
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36 Edg/141.0", "Edge", "Windows"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1", "Safari", "iOS"],
    ["Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36", "Chrome", "Android"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:131.0) Gecko/20100101 Firefox/131.0", "Firefox", "macOS"],
    ["curl/8.0", "", ""],
  ])("%s", (ua, browser, os) => expect(describeUserAgent(ua)).toEqual({ browser, os }));
});

describe("errorKey", () => {
  it("mapea códigos conocidos y oculta los desconocidos", () => {
    expect(errorKey(new ApiError(401, "INVALID_CREDENTIALS", "x"))).toBe("INVALID_CREDENTIALS");
    expect(errorKey(new ApiError(502, "WEIRD", "x"))).toBe("UNAVAILABLE");
    expect(errorKey(new ApiError(418, "TEAPOT", "x"))).toBe("GENERIC");
    expect(errorKey(new Error("boom"))).toBe("GENERIC");
  });
});
