import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { CookieOptions, NextFunction, Request, RequestHandler, Response } from "express";
import type { Env } from "../config/env.js";
import type { RequestMeta } from "../context.js";
import { errors } from "../lib/errors.js";

const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
export const CSRF_HEADER = "x-csrf-token";

export function requestId(): RequestHandler {
  return (req, res, next) => {
    const incoming = req.get("x-request-id");
    const id = incoming && REQUEST_ID.test(incoming) ? incoming : randomUUID();
    res.locals.requestId = id;
    res.setHeader("X-Request-Id", id);
    next();
  };
}

export function metaOf(req: Request, res: Response): RequestMeta {
  return { requestId: String(res.locals.requestId ?? ""), ip: req.ip ?? "", userAgent: req.get("user-agent") ?? "" };
}

/** CORS con allowlist explícita y credenciales; orígenes no listados no reciben cabeceras. */
export function cors(allowed: readonly string[]): RequestHandler {
  const set = new Set(allowed);
  return (req, res, next) => {
    const origin = req.get("origin");
    res.vary("Origin");
    if (origin && set.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Expose-Headers", "X-Request-Id, RateLimit, RateLimit-Policy, Retry-After");
      if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE");
        res.setHeader("Access-Control-Allow-Headers", `Authorization, Content-Type, X-Request-Id, ${CSRF_HEADER}`);
        res.setHeader("Access-Control-Max-Age", "600");
        res.status(204).end();
        return;
      }
    }
    next();
  };
}

/** Rechaza peticiones que cambian estado desde orígenes de navegador no permitidos. */
export function originGuard(allowed: readonly string[]): RequestHandler {
  const set = new Set(allowed);
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.get("origin");
    if (origin && !set.has(origin)) return next(errors.csrf());
    const site = req.get("sec-fetch-site");
    if (!origin && site === "cross-site") return next(errors.csrf());
    next();
  };
}

export interface CookieNames {
  refresh: string;
  csrf: string;
  oauth: string;
}

export function cookieNames(env: Env): CookieNames {
  return env.NODE_ENV === "production"
    ? { refresh: "__Host-as_rt", csrf: "__Host-as_csrf", oauth: "__Host-as_oauth" }
    : { refresh: "as_rt", csrf: "as_csrf", oauth: "as_oauth" };
}

export function baseCookie(env: Env, httpOnly: boolean, maxAgeMs: number): CookieOptions {
  return { httpOnly, secure: env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: maxAgeMs };
}

export function clearCookieOptions(env: Env, httpOnly: boolean, sameSite: "strict" | "lax" = "strict"): CookieOptions {
  return { httpOnly, secure: env.NODE_ENV === "production", sameSite, path: "/" };
}

export function newCsrfToken(): string {
  return randomBytes(24).toString("base64url");
}

/** Doble envío: la cabecera debe coincidir con la cookie legible por el mismo sitio. */
export function requireCsrf(names: CookieNames): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const cookie: unknown = req.cookies?.[names.csrf];
    const header = req.get(CSRF_HEADER);
    if (typeof cookie !== "string" || !header || cookie.length !== header.length) return next(errors.csrf());
    if (!timingSafeEqual(Buffer.from(cookie), Buffer.from(header))) return next(errors.csrf());
    next();
  };
}
