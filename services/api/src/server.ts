import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { createApp } from "./app.js";
import { parseEnv } from "./config/env.js";
import type { AppDeps } from "./context.js";
import { createFieldCipher, parseFieldKey } from "./lib/field-crypto.js";
import { MemoryKv, RedisKv, type Kv } from "./lib/kv.js";
import { createLogger } from "./lib/logger.js";
import { DevOutboxMailer } from "./lib/mailer.js";
import { createHibpChecker } from "./lib/password.js";
import { createTokenService, loadKeys } from "./lib/tokens.js";
import { ensureIndexes } from "./models/index.js";
import { createGoogleClient } from "./services/google.service.js";

const env = parseEnv(process.env);
const logger = createLogger(env.NODE_ENV === "production" ? "info" : "debug");

if (env.NODE_ENV === "production") {
  logger.fatal("No hay transporte de correo de producción configurado (BLK-19); el API no arranca en producción sin él.");
  process.exit(1);
}

const keys = await loadKeys(env.API_JWT_PRIVATE_KEY_PATH, env.API_JWT_PUBLIC_KEY_PATH);
if (keys.ephemeral) logger.warn("Clave EdDSA efímera (solo desarrollo): los tokens se invalidan al reiniciar.");

let fieldKey: Buffer;
if (env.API_FIELD_KEY_B64) fieldKey = parseFieldKey(env.API_FIELD_KEY_B64);
else {
  fieldKey = randomBytes(32);
  logger.warn("API_FIELD_KEY_B64 ausente: clave de campo efímera (solo desarrollo); los datos cifrados no sobreviven al reinicio.");
}

const kv: Kv = env.API_REDIS_URL ? RedisKv.connect(env.API_REDIS_URL, logger) : new MemoryKv();

const deps: AppDeps = {
  env,
  logger,
  kv,
  tokens: createTokenService({ ...keys, kid: env.API_JWT_KID, issuer: env.API_JWT_ISSUER, audience: env.API_JWT_AUDIENCE, accessTtlS: env.API_ACCESS_TTL_S }),
  cipher: createFieldCipher(fieldKey),
  mailer: new DevOutboxMailer(),
  breachChecker: createHibpChecker({ timeoutMs: env.API_HIBP_TIMEOUT_MS }),
  google:
    env.API_GOOGLE_CLIENT_ID && env.API_GOOGLE_CLIENT_SECRET
      ? createGoogleClient({ clientId: env.API_GOOGLE_CLIENT_ID, clientSecret: env.API_GOOGLE_CLIENT_SECRET })
      : null,
  dbReady: () => mongoose.connection.readyState === 1,
  now: Date.now,
};

if (env.API_MONGO_URI) {
  await mongoose.connect(env.API_MONGO_URI, { serverSelectionTimeoutMS: 5000, maxPoolSize: 20 });
  await ensureIndexes();
} else {
  logger.warn("API_MONGO_URI ausente: /readyz responderá 503 y las rutas de cuenta fallarán.");
}

const server = createApp(deps).listen(env.API_PORT, () => {
  logger.info({ port: env.API_PORT, kv: kv.mode(), google: Boolean(deps.google) }, "antisismo-api listening");
});
server.headersTimeout = 15_000;
server.requestTimeout = 20_000;

function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  server.close(() => {
    void Promise.allSettled([mongoose.disconnect(), kv.close()]).then(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
