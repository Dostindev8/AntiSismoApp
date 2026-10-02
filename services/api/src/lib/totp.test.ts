import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, hotp, otpauthUri, totp, verifyTotp } from "./totp.js";

// RFC 6238, Apéndice B (8 dígitos).
const SHA1_SECRET = Buffer.from("12345678901234567890", "ascii");
const SHA256_SECRET = Buffer.from("12345678901234567890123456789012", "ascii");
const SHA512_SECRET = Buffer.from("1234567890123456789012345678901234567890123456789012345678901234", "ascii");

describe("TOTP (RFC 6238)", () => {
  it.each([
    [59, "94287082", "46119246", "90693936"],
    [1_111_111_109, "07081804", "68084774", "25091201"],
    [1_111_111_111, "14050471", "67062674", "99943326"],
    [1_234_567_890, "89005924", "91819424", "93441116"],
    [2_000_000_000, "69279037", "90698825", "38618901"],
    [20_000_000_000, "65353130", "77737706", "47863826"],
  ])("t=%i", (t, sha1, sha256, sha512) => {
    const ms = t * 1000;
    expect(totp(SHA1_SECRET, ms, { digits: 8 })).toBe(sha1);
    expect(totp(SHA256_SECRET, ms, { digits: 8, algorithm: "sha256" })).toBe(sha256);
    expect(totp(SHA512_SECRET, ms, { digits: 8, algorithm: "sha512" })).toBe(sha512);
  });

  it("HOTP RFC 4226 vectores 0..2", () => {
    expect([0, 1, 2].map((c) => hotp(SHA1_SECRET, c))).toEqual(["755224", "287082", "359152"]);
  });

  it("acepta ±1 paso y devuelve el paso usado; rechaza fuera de ventana y formato inválido", () => {
    const now = 1_700_000_000_000;
    const prev = totp(SHA1_SECRET, now - 30_000);
    expect(verifyTotp(SHA1_SECRET, prev, now)).toBe(Math.floor(now / 30_000) - 1);
    expect(verifyTotp(SHA1_SECRET, totp(SHA1_SECRET, now - 90_000), now)).toBeNull();
    expect(verifyTotp(SHA1_SECRET, "12a456", now)).toBeNull();
    expect(verifyTotp(SHA1_SECRET, "1234567", now)).toBeNull();
  });

  it("base32 ida y vuelta (RFC 4648)", () => {
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
    expect(base32Decode("MZXW6YTBOI").toString()).toBe("foobar");
    expect(() => base32Decode("0189")).toThrow();
  });

  it("otpauth URI escapa la etiqueta", () => {
    const uri = otpauthUri(SHA1_SECRET, "ana+test@example.com", "AntiSismo");
    expect(uri.startsWith("otpauth://totp/AntiSismo%3Aana%2Btest%40example.com?")).toBe(true);
    expect(uri).toContain("issuer=AntiSismo");
  });
});
