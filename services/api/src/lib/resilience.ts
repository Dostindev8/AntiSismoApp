export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;

  constructor(
    private readonly threshold: number,
    private readonly cooldownMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get state(): "closed" | "open" | "half-open" {
    if (this.openedAt === null) return "closed";
    return this.now() - this.openedAt >= this.cooldownMs ? "half-open" : "open";
  }

  canRequest(): boolean {
    return this.state !== "open";
  }

  success(): void {
    this.failures = 0;
    this.openedAt = null;
  }

  failure(): void {
    this.failures += 1;
    if (this.failures >= this.threshold) this.openedAt = this.now();
  }
}

export class HostNotAllowedError extends Error {}
export class CircuitOpenError extends Error {}

export interface ResilientFetchOptions {
  allowHosts: readonly string[];
  timeoutMs: number;
  retries: number;
  baseDelayMs: number;
  breaker: CircuitBreaker;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

/** fetch con allowlist https, timeout, reintentos con backoff exponencial + jitter y circuit breaker. */
export async function resilientFetch(url: string, init: RequestInit, opts: ResilientFetchOptions): Promise<Response> {
  const target = new URL(url);
  if (target.protocol !== "https:" || !opts.allowHosts.includes(target.hostname)) {
    throw new HostNotAllowedError(`Host no permitido: ${target.hostname}`);
  }
  if (!opts.breaker.canRequest()) throw new CircuitOpenError(target.hostname);
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = opts.random ?? Math.random;

  let lastError: unknown;
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    if (attempt > 0) await sleep(opts.baseDelayMs * 2 ** (attempt - 1) + random() * opts.baseDelayMs);
    try {
      const res = await doFetch(target, { ...init, redirect: "error", signal: AbortSignal.timeout(opts.timeoutMs) });
      if (!RETRYABLE.has(res.status)) {
        opts.breaker.success();
        return res;
      }
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    }
  }
  opts.breaker.failure();
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
