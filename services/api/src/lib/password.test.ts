import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { checkPolicy, createHibpChecker, hashPassword, verifyPassword } from "./password.js";

const policy = { min: 12, max: 128 };

describe("política de contraseña", () => {
  it("mínimo 12 caracteres (cuenta code points, no bytes)", () => {
    expect(checkPolicy("corta-11ch!", policy)).toEqual(["too_short"]);
    expect(checkPolicy("doce-chars!!", policy)).toEqual([]);
    expect(checkPolicy("ñandú-sísmico", policy)).toEqual([]);
    expect(checkPolicy("🌋".repeat(11), policy)).toEqual(["too_short"]);
    expect(checkPolicy("a".repeat(129), policy)).toEqual(["too_long"]);
  });

  it("rechaza contraseñas que contienen el usuario del correo", () => {
    expect(checkPolicy("mariaperez-2026!", policy, "MariaPerez@example.com")).toEqual(["contains_email"]);
  });
});

describe("argon2id", () => {
  it("hash con parámetros OWASP y verificación", async () => {
    const hash = await hashPassword("una-frase-larga-y-segura");
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
    expect(await verifyPassword(hash, "una-frase-larga-y-segura")).toBe(true);
    expect(await verifyPassword(hash, "otra-frase-larga-y-segura")).toBe(false);
    expect(await verifyPassword("no-es-un-hash", "x")).toBe(false);
  });
});

describe("HIBP k-anonimato", () => {
  const pw = "password123456";
  const sha1 = createHash("sha1").update(pw).digest("hex").toUpperCase();

  it("solo envía el prefijo de 5 caracteres y detecta la filtración", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(`0000000000000000000000000000000000A:0\r\n${sha1.slice(5)}:42\r\n`));
    const result = await createHibpChecker({ timeoutMs: 500, fetchImpl })(pw);
    expect(result).toBe("breached");
    const url = String(fetchImpl.mock.calls[0]?.[0]);
    expect(url).toBe(`https://api.pwnedpasswords.com/range/${sha1.slice(0, 5)}`);
    expect(url).not.toContain(sha1.slice(5));
  });

  it("ignora entradas de relleno con conteo 0 y degrada a 'unknown' ante fallos", async () => {
    const padded = vi.fn<typeof fetch>().mockResolvedValue(new Response(`${sha1.slice(5)}:0\n`));
    expect(await createHibpChecker({ timeoutMs: 500, fetchImpl: padded })(pw)).toBe("ok");
    const down = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
    expect(await createHibpChecker({ timeoutMs: 500, fetchImpl: down })(pw)).toBe("unknown");
  });
});
