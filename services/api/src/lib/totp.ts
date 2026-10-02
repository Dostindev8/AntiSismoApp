import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type TotpAlgorithm = "sha1" | "sha256" | "sha512";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error("Base32 inválido");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function hotp(secret: Buffer, counter: number, digits = 6, algorithm: TotpAlgorithm = "sha1"): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac(algorithm, secret).update(msg).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const bin = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export function totpStep(timeMs: number, stepS = 30): number {
  return Math.floor(timeMs / 1000 / stepS);
}

export function totp(secret: Buffer, timeMs: number, opts: { stepS?: number; digits?: number; algorithm?: TotpAlgorithm } = {}): string {
  return hotp(secret, totpStep(timeMs, opts.stepS), opts.digits, opts.algorithm);
}

/** Devuelve el paso aceptado (para impedir reutilización) o null. Ventana ±window pasos. */
export function verifyTotp(secret: Buffer, code: string, timeMs: number, window = 1, digits = 6): number | null {
  if (!/^\d+$/.test(code) || code.length !== digits) return null;
  const current = totpStep(timeMs);
  const given = Buffer.from(code);
  for (let delta = -window; delta <= window; delta++) {
    const step = current + delta;
    if (step < 0) continue;
    if (timingSafeEqual(Buffer.from(hotp(secret, step, digits)), given)) return step;
  }
  return null;
}

export function newTotpSecret(): Buffer {
  return randomBytes(20);
}

export function otpauthUri(secret: Buffer, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret: base32Encode(secret), issuer, algorithm: "SHA1", digits: "6", period: "30" });
  return `otpauth://totp/${label}?${params.toString()}`;
}
