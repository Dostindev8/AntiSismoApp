import { describe, expect, it } from "vitest";

import { isEmail, normalizeEmail, normalizeMfaCode } from "./forms";

describe("isEmail", () => {
  it.each(["ana@example.com", "a.b+c@sub.example.do"])("acepta %s", (v) => expect(isEmail(v)).toBe(true));
  it.each(["", "ana", "ana@", "@example.com", "ana@example", "ana @example.com", `${"a".repeat(250)}@x.co`])("rechaza %j", (v) =>
    expect(isEmail(v)).toBe(false),
  );
});

describe("normalizeEmail", () => {
  it("recorta y pasa a minúsculas", () => expect(normalizeEmail("  Ana@Example.COM ")).toBe("ana@example.com"));
});

describe("normalizeMfaCode", () => {
  it("TOTP: 6 dígitos, admite espacios", () => {
    expect(normalizeMfaCode("123 456", "totp")).toBe("123456");
    expect(normalizeMfaCode("12345", "totp")).toBeNull();
    expect(normalizeMfaCode("12345a", "totp")).toBeNull();
  });
  it("recuperación: normaliza a XXXX-XXXX-XXXX-XXXX en base32", () => {
    expect(normalizeMfaCode("abcd efgh ijkl mnop", "recovery")).toBe("ABCD-EFGH-IJKL-MNOP");
    expect(normalizeMfaCode("ABCD-EFGH-IJKL-MNO1", "recovery")).toBeNull();
    expect(normalizeMfaCode("ABCD-EFGH", "recovery")).toBeNull();
  });
});
