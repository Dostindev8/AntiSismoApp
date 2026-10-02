import { Redis } from "ioredis";
import type { Logger } from "pino";

export type KvMode = "redis" | "memory" | "degraded";

export interface Kv {
  incr(key: string, ttlMs: number): Promise<{ count: number; resetAt: number }>;
  decr(key: string): Promise<void>;
  del(key: string): Promise<void>;
  mode(): KvMode;
  close(): Promise<void>;
}

const MAX_MEMORY_KEYS = 50_000;

export class MemoryKv implements Kv {
  private readonly store = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  async incr(key: string, ttlMs: number) {
    const t = this.now();
    const entry = this.store.get(key);
    if (entry && entry.resetAt > t) {
      entry.count += 1;
      return { ...entry };
    }
    if (this.store.size >= MAX_MEMORY_KEYS) this.sweep(t);
    const fresh = { count: 1, resetAt: t + ttlMs };
    this.store.set(key, fresh);
    return { ...fresh };
  }

  async decr(key: string) {
    const entry = this.store.get(key);
    if (entry && entry.count > 0) entry.count -= 1;
  }

  async del(key: string) {
    this.store.delete(key);
  }

  mode(): KvMode {
    return "memory";
  }

  async close() {
    this.store.clear();
  }

  private sweep(t: number) {
    for (const [k, v] of this.store) if (v.resetAt <= t) this.store.delete(k);
    if (this.store.size >= MAX_MEMORY_KEYS) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
  }
}

/** Redis como primario; cualquier error degrada a memoria local sin interrumpir la petición. */
export class RedisKv implements Kv {
  private readonly fallback = new MemoryKv();
  private healthy = false;

  constructor(
    private readonly redis: Redis,
    private readonly logger: Logger,
  ) {
    redis.on("ready", () => {
      this.healthy = true;
    });
    redis.on("error", (err: Error) => {
      if (this.healthy) logger.warn({ err: err.message }, "redis no disponible; usando memoria local");
      this.healthy = false;
    });
    redis.on("end", () => {
      this.healthy = false;
    });
  }

  static connect(url: string, logger: Logger): RedisKv {
    const redis = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 1, enableOfflineQueue: false, connectTimeout: 2000 });
    return new RedisKv(redis, logger);
  }

  async incr(key: string, ttlMs: number) {
    if (!this.healthy) return this.fallback.incr(key, ttlMs);
    try {
      const result = await this.redis.multi().incr(key).pexpire(key, ttlMs, "NX").pttl(key).exec();
      const count = Number(result?.[0]?.[1]);
      const ttl = Number(result?.[2]?.[1]);
      if (!Number.isFinite(count)) throw new Error("respuesta redis inválida");
      return { count, resetAt: Date.now() + (ttl > 0 ? ttl : ttlMs) };
    } catch (err) {
      this.logger.warn({ err: (err as Error).message }, "redis incr falló; memoria local");
      return this.fallback.incr(key, ttlMs);
    }
  }

  async decr(key: string) {
    if (!this.healthy) return this.fallback.decr(key);
    try {
      await this.redis.decr(key);
    } catch {
      await this.fallback.decr(key);
    }
  }

  async del(key: string) {
    await this.fallback.del(key);
    if (!this.healthy) return;
    try {
      await this.redis.del(key);
    } catch {
      /* el fallback ya quedó limpio */
    }
  }

  mode(): KvMode {
    return this.healthy ? "redis" : "degraded";
  }

  async close() {
    this.redis.disconnect();
    await this.fallback.close();
  }
}
