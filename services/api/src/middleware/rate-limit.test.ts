import express from "express";
import { pino } from "pino";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { MemoryKv } from "../lib/kv.js";
import { errorHandler } from "./errors.js";
import { createLimiter } from "./rate-limit.js";
import { requestId } from "./security.js";

describe("rate limiting", () => {
  it("devuelve 429 con formato uniforme y cabeceras estándar al superar el límite", async () => {
    const app = express();
    app.use(requestId());
    app.use(createLimiter(new MemoryKv(), "t", 60_000, 2));
    app.get("/", (_req, res) => {
      res.json({ ok: true });
    });
    app.use(errorHandler(pino({ level: "silent" })));

    await request(app).get("/").expect(200);
    const second = await request(app).get("/").expect(200);
    expect(second.headers.ratelimit).toBeDefined();
    const blocked = await request(app).get("/").expect(429);
    expect(blocked.body).toMatchObject({ code: "RATE_LIMITED", message: "Too many requests" });
    expect(blocked.body.requestId).toBeTruthy();
  });
});
