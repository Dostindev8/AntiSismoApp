/**
 * API completa para desarrollo local y pruebas e2e sin Docker: MongoDB en memoria, buzón de correo en memoria
 * y claves efímeras. El buzón se expone SOLO en un puerto de loopback aparte (nunca en createApp) para que
 * Playwright lea los enlaces de verificación/restablecimiento. Se niega a arrancar en producción.
 */
import { randomBytes } from "node:crypto";
import express from "express";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { createApp } from "../app.js";
import { parseEnv } from "../config/env.js";
import type { AppDeps } from "../context.js";
import { createFieldCipher } from "../lib/field-crypto.js";
import { MemoryKv } from "../lib/kv.js";
import { createLogger } from "../lib/logger.js";
import { DevOutboxMailer, type MailTemplate } from "../lib/mailer.js";
import { createTokenService, loadKeys } from "../lib/tokens.js";
import { ensureIndexes } from "../models/index.js";

if (process.env.NODE_ENV === "production") {
  console.error("e2e-server es solo para desarrollo y pruebas");
  process.exit(1);
}

const env = parseEnv({
  NODE_ENV: "development",
  API_HIBP_ENABLED: "false",
  API_RATE_AUTH_MAX: "2000",
  API_RATE_MAX: "20000",
  ...process.env,
});
const outboxPort = Number(process.env.API_E2E_OUTBOX_PORT ?? 8091);
const logger = createLogger(process.env.API_E2E_LOG_LEVEL ?? "warn");

const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri(), { dbName: "antisismo-e2e" });
await ensureIndexes();

const keys = await loadKeys();
const mailer = new DevOutboxMailer();
const deps: AppDeps = {
  env,
  logger,
  kv: new MemoryKv(),
  tokens: createTokenService({ ...keys, kid: env.API_JWT_KID, issuer: env.API_JWT_ISSUER, audience: env.API_JWT_AUDIENCE, accessTtlS: env.API_ACCESS_TTL_S }),
  cipher: createFieldCipher(randomBytes(32)),
  mailer,
  breachChecker: async () => "ok",
  google: null,
  dbReady: () => mongoose.connection.readyState === 1,
  now: Date.now,
};

const api = createApp(deps).listen(env.API_PORT, "127.0.0.1", () => {
  logger.warn({ port: env.API_PORT, outboxPort }, "e2e/dev API listening (Mongo en memoria, buzón en memoria)");
});

const TEMPLATES: readonly MailTemplate[] = ["verify-email", "reset-password", "account-exists", "new-login", "password-changed"];
const outbox = express();
outbox.disable("x-powered-by");
outbox.get("/outbox", (req, res) => {
  const to = typeof req.query.to === "string" ? req.query.to.toLowerCase() : "";
  const template = TEMPLATES.find((t) => t === req.query.template);
  const message = template ? mailer.last(to, template) : undefined;
  if (!message) {
    res.status(404).json({ code: "NOT_FOUND" });
    return;
  }
  res.json(message);
});
const outboxServer = outbox.listen(outboxPort, "127.0.0.1");

function shutdown() {
  api.close();
  outboxServer.close();
  void Promise.allSettled([mongoose.disconnect(), mongo.stop()]).then(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
