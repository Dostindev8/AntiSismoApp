import { rateLimit, type Options, type Store } from "express-rate-limit";
import type { RequestHandler } from "express";
import { errors } from "../lib/errors.js";
import type { Kv } from "../lib/kv.js";

class KvStore implements Store {
  private windowMs = 60_000;
  readonly localKeys = false;

  constructor(
    private readonly kv: Kv,
    readonly prefix: string,
  ) {}

  init(options: Options) {
    this.windowMs = options.windowMs;
  }

  async increment(key: string) {
    const { count, resetAt } = await this.kv.incr(this.prefix + key, this.windowMs);
    return { totalHits: count, resetTime: new Date(resetAt) };
  }

  async decrement(key: string) {
    await this.kv.decr(this.prefix + key);
  }

  async resetKey(key: string) {
    await this.kv.del(this.prefix + key);
  }
}

export function createLimiter(kv: Kv, name: string, windowMs: number, limit: number): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    store: new KvStore(kv, `rl:${name}:`),
    handler: (_req, _res, next) => next(errors.tooMany()),
  });
}
