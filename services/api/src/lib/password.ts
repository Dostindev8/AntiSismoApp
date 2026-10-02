import { createHash } from "node:crypto";
import argon2 from "argon2";
import { CircuitBreaker, resilientFetch } from "./resilience.js";

export const HIBP_HOST = "api.pwnedpasswords.com";

const ARGON_OPTS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export interface PasswordPolicy {
  min: number;
  max: number;
}

export type PolicyViolation = "too_short" | "too_long" | "contains_email";

export function checkPolicy(password: string, policy: PasswordPolicy, email?: string): PolicyViolation[] {
  const issues: PolicyViolation[] = [];
  const length = [...password].length;
  if (length < policy.min) issues.push("too_short");
  if (length > policy.max) issues.push("too_long");
  const local = email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && password.toLowerCase().includes(local)) issues.push("contains_email");
  return issues;
}

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON_OPTS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;
/** Iguala el tiempo de respuesta cuando la cuenta no existe (anti-enumeración). */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword("antisismo-timing-equalizer-0000");
  await verifyPassword(await dummyHash, password);
}

export type BreachResult = "breached" | "ok" | "unknown";
export type BreachChecker = (password: string) => Promise<BreachResult>;

/** k-anonimato: solo se envían los 5 primeros caracteres del SHA-1. Fallo de red ⇒ "unknown" (degradado, no bloquea). */
export function createHibpChecker(opts: { timeoutMs: number; fetchImpl?: typeof fetch }): BreachChecker {
  const breaker = new CircuitBreaker(3, 60_000);
  return async (password) => {
    const sha1 = createHash("sha1").update(password).digest("hex").toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);
    try {
      const res = await resilientFetch(
        `https://${HIBP_HOST}/range/${prefix}`,
        { headers: { "Add-Padding": "true", "User-Agent": "antisismo-api" } },
        { allowHosts: [HIBP_HOST], timeoutMs: opts.timeoutMs, retries: 1, baseDelayMs: 100, breaker, ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}) },
      );
      if (!res.ok) return "unknown";
      const body = await res.text();
      for (const line of body.split("\n")) {
        const [hashSuffix, count] = line.trim().split(":");
        if (hashSuffix === suffix && Number(count) > 0) return "breached";
      }
      return "ok";
    } catch {
      return "unknown";
    }
  };
}
