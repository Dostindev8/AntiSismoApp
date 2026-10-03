import { ApiError } from "../api/client";

/** Solo rutas internas relativas: bloquea redirecciones abiertas (`//evil`, `https:`, `\\`, `javascript:`). */
export function safeNextPath(value: string | null | undefined, fallback = "/account"): string {
  if (!value || value.length > 512) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;
  try {
    const url = new URL(value, "https://antisismo.invalid");
    if (url.origin !== "https://antisismo.invalid") return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

/** Lee `#token=...` del fragmento (nunca viaja al servidor ni a los logs) y valida su forma. */
export function tokenFromHash(hash: string, key = "token"): string | null {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const value = params.get(key);
  if (!value) return null;
  if (key === "token") return /^[A-Za-z0-9_-]{32,128}$/.test(value) ? value : null;
  return value.length <= 4096 ? value : null;
}

export type StrengthLevel = 0 | 1 | 2 | 3 | 4;
export interface Strength {
  level: StrengthLevel;
  meetsPolicy: boolean;
  issues: Array<"tooShort" | "tooLong" | "containsEmail" | "repetitive" | "common" | "fewClasses">;
}

const COMMON = ["password", "contrasena", "contraseña", "123456", "qwerty", "antisismo", "dominicana", "terremoto", "abc123", "iloveyou", "admin"];

/**
 * Estimación local orientativa (no sustituye la política del servidor ni la comprobación de filtraciones,
 * que hace el API por k-anonimato: solo envía a HIBP los 5 primeros caracteres del hash SHA-1).
 */
export function passwordStrength(password: string, opts: { min: number; max?: number; email?: string }): Strength {
  const issues: Strength["issues"] = [];
  const max = opts.max ?? 128;
  const lower = password.toLowerCase();
  if (password.length < opts.min) issues.push("tooShort");
  if (password.length > max) issues.push("tooLong");
  const local = opts.email?.split("@")[0]?.toLowerCase() ?? "";
  if (local.length >= 3 && lower.includes(local)) issues.push("containsEmail");
  if (/(.)\1{3,}/.test(password) || new Set(password).size <= Math.max(3, Math.floor(password.length / 4))) issues.push("repetitive");
  if (COMMON.some((w) => lower.includes(w))) issues.push("common");
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
  if (classes < 2 && password.length < 20) issues.push("fewClasses");

  let level: StrengthLevel = 0;
  if (password.length >= opts.min) level = 1;
  if (password.length >= opts.min && classes >= 2) level = 2;
  if (password.length >= opts.min + 4 && classes >= 3) level = 3;
  if (password.length >= opts.min + 8 && classes >= 3) level = 4;
  if (issues.some((i) => i !== "fewClasses")) level = Math.min(level, 1) as StrengthLevel;
  const meetsPolicy = !issues.includes("tooShort") && !issues.includes("tooLong") && !issues.includes("containsEmail");
  return { level, meetsPolicy, issues };
}

/** Descripción legible del dispositivo a partir del User-Agent guardado (sin huellas adicionales). */
export function describeUserAgent(ua: string): { browser: string; os: string } {
  const browser =
    /Edg\//.test(ua) ? "Edge"
    : /OPR\//.test(ua) ? "Opera"
    : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : "";
  const os =
    /Windows/.test(ua) ? "Windows"
    : /Android/.test(ua) ? "Android"
    : /iPhone|iPad|iPod/.test(ua) ? "iOS"
    : /Mac OS X|Macintosh/.test(ua) ? "macOS"
    : /Linux/.test(ua) ? "Linux"
    : "";
  return { browser, os };
}

const KNOWN = new Set([
  "INVALID_CREDENTIALS",
  "EMAIL_NOT_VERIFIED",
  "WEAK_PASSWORD",
  "BREACHED_PASSWORD",
  "INVALID_TOKEN",
  "INVALID_MFA_CODE",
  "RATE_LIMITED",
  "NETWORK_ERROR",
  "TIMEOUT",
  "VALIDATION_ERROR",
  "TERMS_OUTDATED",
  "CSRF_REJECTED",
  "UNAVAILABLE",
  "MFA_ALREADY_ENABLED",
  "MFA_SETUP_REQUIRED",
  "MFA_NOT_ENABLED",
  "UNAUTHENTICATED",
  "API_NOT_CONFIGURED",
]);

/** Clave i18n `errors.<code>`; códigos desconocidos caen en un mensaje genérico (sin filtrar detalles). */
export function errorKey(err: unknown): string {
  if (err instanceof ApiError) {
    if (KNOWN.has(err.code)) return err.code;
    if (err.status >= 500) return "UNAVAILABLE";
  }
  return "GENERIC";
}
