import { randomBytes } from "node:crypto";
import type { Express } from "express";
import type { JWTVerifyGetKey } from "jose";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { pino } from "pino";
import request from "supertest";
import { createApp } from "../app.js";
import { parseEnv } from "../config/env.js";
import type { AppDeps } from "../context.js";
import { createFieldCipher } from "../lib/field-crypto.js";
import { MemoryKv } from "../lib/kv.js";
import { DevOutboxMailer } from "../lib/mailer.js";
import type { BreachResult } from "../lib/password.js";
import { createTokenService, loadKeys } from "../lib/tokens.js";
import { ensureIndexes } from "../models/index.js";
import { createGoogleClient } from "../services/google.service.js";

export const WEB = "http://localhost:3000";

export interface Harness {
  app: Express;
  deps: AppDeps;
  mailer: DevOutboxMailer;
  clock: { now: number };
  breach: { result: BreachResult };
  google: { jwks: JWTVerifyGetKey | null; idToken: string | null; fetchCalls: number };
  stop(): Promise<void>;
}

export async function startHarness(overrides: Record<string, string> = {}): Promise<Harness> {
  const mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri(), { dbName: "antisismo-test" });
  await ensureIndexes();

  const env = parseEnv({
    NODE_ENV: "test",
    API_WEB_ORIGIN: WEB,
    API_RATE_AUTH_MAX: "1000",
    API_RATE_MAX: "10000",
    API_GOOGLE_CLIENT_ID: "test-client.apps.googleusercontent.com",
    API_GOOGLE_CLIENT_SECRET: "test-secret",
    ...overrides,
  });
  const keys = await loadKeys();
  const mailer = new DevOutboxMailer();
  const clock = { now: Date.now() };
  const breach: { result: BreachResult } = { result: "ok" };
  const google: Harness["google"] = { jwks: null, idToken: null, fetchCalls: 0 };

  const googleClient = createGoogleClient({
    clientId: env.API_GOOGLE_CLIENT_ID ?? "",
    clientSecret: env.API_GOOGLE_CLIENT_SECRET ?? "",
    jwks: (header, token) => {
      if (!google.jwks) throw new Error("jwks no configurado");
      return google.jwks(header, token);
    },
    fetchImpl: async () => {
      google.fetchCalls += 1;
      return new Response(JSON.stringify({ id_token: google.idToken }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });

  const deps: AppDeps = {
    env,
    logger: pino({ level: "silent" }),
    kv: new MemoryKv(() => clock.now),
    tokens: createTokenService({ ...keys, kid: "k-test", issuer: env.API_JWT_ISSUER, audience: env.API_JWT_AUDIENCE, accessTtlS: env.API_ACCESS_TTL_S }),
    cipher: createFieldCipher(randomBytes(32)),
    mailer,
    breachChecker: async () => breach.result,
    google: googleClient,
    dbReady: () => mongoose.connection.readyState === 1,
    now: () => clock.now,
  };

  return {
    app: createApp(deps),
    deps,
    mailer,
    clock,
    breach,
    google,
    async stop() {
      await mongoose.disconnect();
      await mongo.stop();
    },
  };
}

export function tokenFromLink(link: string | undefined): string {
  const token = link?.split("#token=")[1];
  if (!token) throw new Error(`link sin token: ${link}`);
  return token;
}

export function cookiesOf(res: request.Response): Record<string, string> {
  const raw = res.headers["set-cookie"] as unknown;
  const list = Array.isArray(raw) ? (raw as string[]) : typeof raw === "string" ? [raw] : [];
  const out: Record<string, string> = {};
  for (const c of list) {
    const [pair] = c.split(";");
    const idx = pair?.indexOf("=") ?? -1;
    if (pair && idx > 0) out[pair.slice(0, idx)] = pair.slice(idx + 1);
  }
  return out;
}

export function rawCookies(res: request.Response): string[] {
  const raw = res.headers["set-cookie"] as unknown;
  return Array.isArray(raw) ? (raw as string[]) : typeof raw === "string" ? [raw] : [];
}
