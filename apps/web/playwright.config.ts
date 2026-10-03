import { defineConfig, devices } from "@playwright/test";

const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3000);
const API_PORT = Number(process.env.E2E_API_PORT ?? 8080);
const OUTBOX_PORT = Number(process.env.API_E2E_OUTBOX_PORT ?? 8091);
const WEB = `http://localhost:${WEB_PORT}`;

/**
 * e2e contra el API real (Mongo en memoria, buzón de loopback) y la web compilada en modo producción.
 * Nunca apunta a servicios externos ni a números de emergencia reales.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  outputDir: "./test-results",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "./playwright-report" }]],
  use: {
    baseURL: WEB,
    locale: "es-DO",
    timezoneId: "America/Santo_Domingo",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm --filter @antisismo/api dev:memory",
      url: `http://127.0.0.1:${API_PORT}/healthz`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        API_PORT: String(API_PORT),
        API_E2E_OUTBOX_PORT: String(OUTBOX_PORT),
        API_WEB_ORIGIN: WEB,
        API_PUBLIC_ORIGIN: `${WEB}/api`,
      },
    },
    {
      command: "pnpm build && pnpm start",
      url: WEB,
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
      env: { API_INTERNAL_ORIGIN: `http://127.0.0.1:${API_PORT}`, PORT: String(WEB_PORT) },
    },
  ],
});

export const OUTBOX = `http://127.0.0.1:${OUTBOX_PORT}`;
