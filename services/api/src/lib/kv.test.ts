import { describe, expect, it } from "vitest";
import { MemoryKv } from "./kv.js";

describe("MemoryKv", () => {
  it("cuenta dentro de la ventana y reinicia al expirar", async () => {
    let t = 1000;
    const kv = new MemoryKv(() => t);
    expect(await kv.incr("k", 100)).toEqual({ count: 1, resetAt: 1100 });
    expect((await kv.incr("k", 100)).count).toBe(2);
    await kv.decr("k");
    expect((await kv.incr("k", 100)).count).toBe(2);
    t = 1100;
    expect(await kv.incr("k", 100)).toEqual({ count: 1, resetAt: 1200 });
    await kv.del("k");
    expect((await kv.incr("k", 100)).count).toBe(1);
    expect(kv.mode()).toBe("memory");
  });
});
