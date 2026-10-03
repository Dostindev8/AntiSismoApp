import { createHmac, randomBytes } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

import { OUTBOX } from "../playwright.config";

export const PASSWORD = "sismo-placa-caribe-2026-Norte";
export const NEW_PASSWORD = "falla-septentrional-2026-Cibao";

export function uniqueEmail(tag: string): string {
  return `e2e-${tag}-${randomBytes(4).toString("hex")}@example.com`;
}

/** Último correo del buzón de loopback del API de pruebas (reintenta: el envío es asíncrono). */
export async function mailLink(to: string, template: "verify-email" | "reset-password"): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`${OUTBOX}/outbox?to=${encodeURIComponent(to)}&template=${template}`);
    if (res.ok) {
      const body = (await res.json()) as { vars: Record<string, string> };
      const link = body.vars.link;
      if (link) return link;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`sin correo ${template} para ${to}`);
}

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Decode(input: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of input.replace(/\s+/g, "").toUpperCase()) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** TOTP RFC 6238 (SHA-1, 30 s, 6 dígitos) para el paso `offset` relativo al actual. */
export function totp(secret: string, offset = 0): string {
  const counter = Math.floor(Date.now() / 30_000) + offset;
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", base32Decode(secret)).update(msg).digest();
  const o = mac[mac.length - 1]! & 0x0f;
  return String((mac.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

/** WCAG 2.2 AA: cero violaciones serias o críticas (las menores se listan en el reporte). */
export async function expectAccessible(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(blocking.map((v) => `${label}: ${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

export async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/auth/login");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
}
