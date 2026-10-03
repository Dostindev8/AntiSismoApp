import { describe, expect, it, vi } from "vitest";

import { ApiError, REFRESH_LOCK, createAccountClient, type LockManagerLike } from "./client";

const USER = {
  id: "a".repeat(24),
  email: "ana@example.com",
  displayName: null,
  roles: ["user"],
  locale: "es-DO",
  emailVerified: true,
  mfaEnabled: false,
  phone: null,
  termsVersion: "2026-10-03",
};
const session = (n: number) => ({ accessToken: `access-token-${n}-${"x".repeat(20)}`, tokenType: "Bearer", expiresIn: 900, csrfToken: "c".repeat(43), user: USER });
const json = (status: number, body: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Route = (init: RequestInit) => Response | Promise<Response>;
function fakeFetch(routes: Record<string, Route | Route[]>) {
  const calls: Array<{ path: string; init: RequestInit }> = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace("/api/v1", "");
    const key = `${init?.method ?? "GET"} ${path}`;
    calls.push({ path: key, init: init ?? {} });
    const route = routes[key];
    const handler = Array.isArray(route) ? route.shift() : route;
    if (!handler) throw new Error(`ruta inesperada ${key}`);
    return handler(init ?? {});
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

describe("cliente de cuentas", () => {
  it("login guarda el access token solo en memoria y lo envía como Bearer; same-origin y no-store", async () => {
    const f = fakeFetch({ "POST /auth/login": () => json(200, session(1)), "GET /me": () => json(200, USER) });
    const onSession = vi.fn();
    const client = createAccountClient({ fetch: f.fn, onSession });
    await client.login("ana@example.com", "clave-larga-segura");
    await client.me();
    const me = f.calls[1]?.init;
    expect((me?.headers as Record<string, string>).Authorization).toBe(`Bearer ${session(1).accessToken}`);
    expect(me?.credentials).toBe("same-origin");
    expect(me?.cache).toBe("no-store");
    expect(onSession).toHaveBeenCalledWith(USER);
    expect(JSON.stringify(onSession.mock.calls)).not.toContain(session(1).accessToken);
  });

  it("MFA: devuelve mfaToken sin abrir sesión", async () => {
    const f = fakeFetch({ "POST /auth/login": () => json(200, { mfaRequired: true, mfaToken: "m".repeat(40) }) });
    const client = createAccountClient({ fetch: f.fn });
    expect(await client.login("a@b.co", "x")).toEqual({ mfaToken: "m".repeat(40) });
    expect(client.authenticated).toBe(false);
  });

  it("401 → pide CSRF nuevo, rota el refresh dentro del lock y reintenta una sola vez", async () => {
    const f = fakeFetch({
      "POST /auth/login": () => json(200, session(1)),
      "GET /me": [() => json(401, { code: "UNAUTHENTICATED", message: "x", requestId: "r" }), () => json(200, USER)],
      "GET /auth/csrf": () => json(200, { csrfToken: "n".repeat(43) }),
      "POST /auth/refresh": (init) => {
        expect((init.headers as Record<string, string>)["X-CSRF-Token"]).toBe("n".repeat(43));
        return json(200, session(2));
      },
    });
    const names: string[] = [];
    const locks: LockManagerLike = { request: async (name, cb) => (names.push(name), cb()) };
    const client = createAccountClient({ fetch: f.fn, locks });
    await client.login("a@b.co", "x");
    await expect(client.me()).resolves.toEqual(USER);
    expect(names).toEqual([REFRESH_LOCK]);
    const retried = f.calls.at(-1)?.init.headers as Record<string, string>;
    expect(retried.Authorization).toBe(`Bearer ${session(2).accessToken}`);
  });

  it("refresh concurrente en la misma pestaña se hace una sola vez", async () => {
    const f = fakeFetch({
      "GET /auth/csrf": () => json(200, { csrfToken: "n".repeat(43) }),
      "POST /auth/refresh": () => json(200, session(3)),
      "GET /me": () => json(200, USER),
      "GET /me/sessions": () => json(200, { sessions: [] }),
    });
    const client = createAccountClient({ fetch: f.fn });
    await Promise.all([client.me(), client.sessions()]);
    expect(f.calls.filter((c) => c.path === "POST /auth/refresh")).toHaveLength(1);
  });

  it("refresh fallido limpia la sesión y propaga el error", async () => {
    const f = fakeFetch({
      "GET /auth/csrf": () => json(200, { csrfToken: "n".repeat(43) }),
      "POST /auth/refresh": () => json(401, { code: "INVALID_TOKEN", message: "x", requestId: "r" }),
    });
    const onSession = vi.fn();
    const client = createAccountClient({ fetch: f.fn, onSession });
    await expect(client.restore()).rejects.toMatchObject({ code: "INVALID_TOKEN", status: 401 });
    expect(onSession).toHaveBeenLastCalledWith(null);
  });

  it("errores: formato del API, 5xx sin cuerpo, respuesta inválida y red caída", async () => {
    const f = fakeFetch({
      "POST /auth/login": [
        () => json(401, { code: "INVALID_CREDENTIALS", message: "Invalid credentials", requestId: "req-1" }),
        () => new Response("<html>", { status: 502 }),
        () => json(200, { unexpected: true }),
        () => Promise.reject(new TypeError("Failed to fetch")),
      ],
    });
    const client = createAccountClient({ fetch: f.fn });
    await expect(client.login("a@b.co", "x")).rejects.toMatchObject({ code: "INVALID_CREDENTIALS", requestId: "req-1" });
    await expect(client.login("a@b.co", "x")).rejects.toMatchObject({ code: "UNAVAILABLE", status: 502 });
    await expect(client.login("a@b.co", "x")).rejects.toMatchObject({ code: "BAD_RESPONSE" });
    const err = await client.login("a@b.co", "x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: "NETWORK_ERROR", status: 0 });
  });

  it("logout pide CSRF, revoca y limpia aunque el API falle", async () => {
    const f = fakeFetch({
      "POST /auth/login": () => json(200, session(1)),
      "GET /auth/csrf": () => json(200, { csrfToken: "n".repeat(43) }),
      "POST /auth/logout": () => json(503, undefined),
    });
    const onSession = vi.fn();
    const client = createAccountClient({ fetch: f.fn, onSession });
    await client.login("a@b.co", "x");
    await expect(client.logout()).rejects.toBeInstanceOf(ApiError);
    expect(client.authenticated).toBe(false);
    expect(onSession).toHaveBeenLastCalledWith(null);
  });
});
