import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createFieldCipher, parseFieldKey } from "./field-crypto.js";

describe("cifrado de campo AES-256-GCM", () => {
  const cipher = createFieldCipher(randomBytes(32));

  it("cifra con IV aleatorio y descifra con el mismo AAD", () => {
    const a = cipher.encrypt("+18095550100", "user:1:phone");
    const b = cipher.encrypt("+18095550100", "user:1:phone");
    expect(a).not.toBe(b);
    expect(a.startsWith("v1.")).toBe(true);
    expect(a).not.toContain("8095550100");
    expect(cipher.decrypt(a, "user:1:phone")).toBe("+18095550100");
  });

  it("rechaza AAD distinto (no se puede mover el valor a otro usuario) y datos alterados", () => {
    const enc = cipher.encrypt("secreto", "user:1:phone");
    expect(() => cipher.decrypt(enc, "user:2:phone")).toThrow();
    const parts = enc.split(".");
    const ct = Buffer.from(parts[3] ?? "", "base64url");
    ct[0] = (ct[0] ?? 0) ^ 1;
    expect(() => cipher.decrypt([parts[0], parts[1], parts[2], ct.toString("base64url")].join("."), "user:1:phone")).toThrow();
    expect(() => cipher.decrypt("v0.x.y.z", "user:1:phone")).toThrow();
  });

  it("otra clave no descifra; blind index es determinista y no reversible a simple vista", () => {
    const other = createFieldCipher(randomBytes(32));
    expect(() => other.decrypt(cipher.encrypt("x", "a"), "a")).toThrow();
    expect(cipher.blindIndex("203.0.113.7")).toBe(cipher.blindIndex("203.0.113.7"));
    expect(cipher.blindIndex("203.0.113.7")).not.toContain("203");
    expect(other.blindIndex("203.0.113.7")).not.toBe(cipher.blindIndex("203.0.113.7"));
  });

  it("valida longitud de clave", () => {
    expect(() => createFieldCipher(randomBytes(16))).toThrow();
    expect(() => parseFieldKey(randomBytes(31).toString("base64"))).toThrow();
    expect(parseFieldKey(randomBytes(32).toString("base64"))).toHaveLength(32);
  });
});
