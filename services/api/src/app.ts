import cookieParser from "cookie-parser";
import express, { Router, type Express } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import type { AppDeps } from "./context.js";
import { createAdminController } from "./controllers/admin.controller.js";
import { createAuthController } from "./controllers/auth.controller.js";
import { createMeController } from "./controllers/me.controller.js";
import { requireAuth, requireMfaSession, requireRole } from "./middleware/auth.js";
import { errorHandler, notFoundHandler } from "./middleware/errors.js";
import { createLimiter } from "./middleware/rate-limit.js";
import { cookieNames, cors, originGuard, requestId, requireCsrf } from "./middleware/security.js";
import { buildOpenApi } from "./openapi.js";
import { createAuditor } from "./services/audit.service.js";
import { createAuthService } from "./services/auth.service.js";
import { createMfaService } from "./services/mfa.service.js";

function parseTrustProxy(value: string): string | number | boolean {
  if (/^\d+$/.test(value)) return Number(value);
  if (value === "false") return false;
  return value;
}

export function createApp(deps: AppDeps): Express {
  const { env, logger } = deps;
  const audit = createAuditor(deps);
  const auth = createAuthService(deps, audit);
  const mfa = createMfaService(deps, audit, auth);
  const names = cookieNames(env);
  const authCtl = createAuthController(deps, auth, names);
  const meCtl = createMeController(deps, auth, mfa, audit);
  const adminCtl = createAdminController(audit);
  const openapi = buildOpenApi(env.API_PUBLIC_ORIGIN);

  const app = express();
  app.set("trust proxy", parseTrustProxy(env.API_TRUST_PROXY));
  app.disable("x-powered-by");
  app.set("etag", false);

  app.use(requestId());
  app.use(
    pinoHttp({
      logger,
      genReqId: (_req, res) => String(res.getHeader("X-Request-Id") ?? ""),
      autoLogging: env.NODE_ENV !== "test",
    }),
  );
  app.use(
    helmet({
      contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"] } },
      crossOriginResourcePolicy: { policy: "same-site" },
      strictTransportSecurity: env.NODE_ENV === "production" ? { maxAge: 63_072_000, includeSubDomains: true, preload: true } : false,
    }),
  );
  app.use(cors(env.API_CORS_ORIGINS));
  app.use(createLimiter(deps.kv, "global", env.API_RATE_WINDOW_MS, env.API_RATE_MAX));
  app.use(express.json({ limit: "32kb", strict: true }));
  app.use(originGuard(env.API_CORS_ORIGINS));

  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok", time: deps.now() });
  });
  app.get("/readyz", (_req, res) => {
    const db = deps.dbReady();
    const cache = deps.kv.mode();
    res.status(db ? 200 : 503).json({ status: db ? (cache === "degraded" ? "degraded" : "ready") : "unavailable", db: db ? "up" : "down", cache, time: deps.now() });
  });
  app.get("/.well-known/jwks.json", async (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json(await deps.tokens.jwks());
  });
  app.get("/v1/openapi.json", (_req, res) => {
    res.json(openapi);
  });

  const authLimiter = createLimiter(deps.kv, "auth", env.API_RATE_AUTH_WINDOW_MS, env.API_RATE_AUTH_MAX);
  // Renovar sesión ocurre en cada recarga: límite propio para no bloquear el login por navegar.
  const sessionLimiter = createLimiter(deps.kv, "session", env.API_RATE_AUTH_WINDOW_MS, env.API_RATE_SESSION_MAX);
  const csrf = requireCsrf(names);
  const cookies = cookieParser();
  const authRoutes = Router();
  authRoutes.get("/policy", (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({
      termsVersion: env.API_TERMS_VERSION,
      password: { min: env.API_PASSWORD_MIN, max: env.API_PASSWORD_MAX },
      google: deps.google !== null,
    });
  });
  authRoutes.get("/csrf", sessionLimiter, authCtl.csrf);
  authRoutes.post("/register", authLimiter, authCtl.register);
  authRoutes.post("/verify-email", authLimiter, authCtl.verifyEmail);
  authRoutes.post("/verify-email/resend", authLimiter, authCtl.resendVerification);
  authRoutes.post("/login", authLimiter, authCtl.login);
  authRoutes.post("/login/mfa", authLimiter, authCtl.loginMfa);
  authRoutes.post("/refresh", sessionLimiter, cookies, csrf, authCtl.refresh);
  authRoutes.post("/logout", sessionLimiter, cookies, csrf, authCtl.logout);
  authRoutes.post("/password/forgot", authLimiter, authCtl.forgotPassword);
  authRoutes.post("/password/reset", authLimiter, authCtl.resetPassword);
  authRoutes.get("/google/start", authLimiter, authCtl.googleStart);
  authRoutes.get("/google/callback", authLimiter, cookies, authCtl.googleCallback);
  app.use("/v1/auth", authRoutes);

  const authenticated = requireAuth(deps.tokens, (sid) => auth.sessionIsActive(sid));
  const me = Router();
  me.use(authenticated);
  me.get("/", meCtl.get);
  me.patch("/", meCtl.update);
  me.get("/sessions", meCtl.listSessions);
  me.post("/sessions/revoke-others", meCtl.revokeOtherSessions);
  me.delete("/sessions/:id", meCtl.revokeSession);
  me.post("/terms", meCtl.acceptTerms);
  me.post("/mfa/setup", meCtl.mfaSetup);
  me.post("/mfa/enable", authLimiter, meCtl.mfaEnable);
  me.post("/mfa/disable", authLimiter, meCtl.mfaDisable);
  app.use("/v1/me", me);

  const admin = Router();
  admin.use(authenticated, requireRole("platform_admin"), requireMfaSession);
  admin.get("/audit", adminCtl.listAudit);
  admin.patch("/users/:id/roles", adminCtl.setRoles);
  app.use("/v1/admin", admin);

  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}
