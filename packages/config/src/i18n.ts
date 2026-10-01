import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const BASE_LOCALE = "es-DO";

const i18nDir = join(dirname(fileURLToPath(import.meta.url)), "..", "i18n");

export type Messages = Readonly<Record<string, string>>;

export function listLocales(): string[] {
  return readdirSync(i18nDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
}

export function loadRaw(locale: string): Record<string, string> {
  if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(locale)) throw new Error(`Invalid locale: ${locale}`);
  return JSON.parse(readFileSync(join(i18nDir, `${locale}.json`), "utf8")) as Record<string, string>;
}

/** Mensajes efectivos: base es-DO + overrides del locale (los overrides solo pueden redefinir claves base). */
export function loadMessages(locale: string): Messages {
  const base = loadRaw(BASE_LOCALE);
  if (locale === BASE_LOCALE) return Object.freeze(base);
  return Object.freeze({ ...base, ...loadRaw(locale) });
}

export function placeholders(s: string): string[] {
  return [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
}

export function format(template: string, params: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = params[k];
    if (v === undefined) throw new Error(`Missing i18n param: ${k}`);
    return String(v);
  });
}
