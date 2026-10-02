import { describe, expect, it, vi } from "vitest";
import { CircuitBreaker, CircuitOpenError, HostNotAllowedError, resilientFetch } from "./resilience.js";

const noSleep = async () => undefined;

describe("resilientFetch", () => {
  it("rechaza hosts fuera de la allowlist y http plano", async () => {
    const opts = { allowHosts: ["api.example.org"], timeoutMs: 100, retries: 0, baseDelayMs: 1, breaker: new CircuitBreaker(3, 1000) };
    await expect(resilientFetch("https://evil.example.org/x", {}, opts)).rejects.toBeInstanceOf(HostNotAllowedError);
    await expect(resilientFetch("http://api.example.org/x", {}, opts)).rejects.toBeInstanceOf(HostNotAllowedError);
  });

  it("reintenta 5xx con backoff exponencial + jitter y devuelve el primer éxito", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const delays: number[] = [];
    const res = await resilientFetch("https://api.example.org/x", {}, {
      allowHosts: ["api.example.org"],
      timeoutMs: 100,
      retries: 2,
      baseDelayMs: 100,
      breaker: new CircuitBreaker(3, 1000),
      fetchImpl,
      sleep: async (ms) => {
        delays.push(ms);
      },
      random: () => 0.5,
    });
    expect(await res.text()).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([150, 250]);
  });

  it("no reintenta 4xx no transitorios", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 404 }));
    const res = await resilientFetch("https://api.example.org/x", {}, { allowHosts: ["api.example.org"], timeoutMs: 100, retries: 3, baseDelayMs: 1, breaker: new CircuitBreaker(3, 1000), fetchImpl, sleep: noSleep });
    expect(res.status).toBe(404);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("abre el circuito tras N fallos y se semiabre tras el enfriamiento", async () => {
    let t = 0;
    const breaker = new CircuitBreaker(2, 1000, () => t);
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error("down"));
    const opts = { allowHosts: ["api.example.org"], timeoutMs: 100, retries: 0, baseDelayMs: 1, breaker, fetchImpl, sleep: noSleep };
    await expect(resilientFetch("https://api.example.org/x", {}, opts)).rejects.toThrow("down");
    await expect(resilientFetch("https://api.example.org/x", {}, opts)).rejects.toThrow("down");
    expect(breaker.state).toBe("open");
    await expect(resilientFetch("https://api.example.org/x", {}, opts)).rejects.toBeInstanceOf(CircuitOpenError);
    t = 1000;
    expect(breaker.state).toBe("half-open");
    breaker.success();
    expect(breaker.state).toBe("closed");
  });
});
