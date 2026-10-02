import type { Request, Response } from "express";
import type { AppDeps } from "../context.js";
import { errors } from "../lib/errors.js";
import { clearCookieOptions, metaOf, newCsrfToken, type CookieNames } from "../middleware/security.js";
import type { AuthService, IssuedSession } from "../services/auth.service.js";
import { emailBody, loginBody, mfaLoginBody, oauthCallbackQuery, oauthFlow, registerBody, resetBody, tokenBody } from "./schemas.js";

const OAUTH_AAD = "cookie:oauth-flow";
const OAUTH_TTL_S = 600;

export function createAuthController(deps: AppDeps, auth: AuthService, names: CookieNames) {
  const { env } = deps;
  const refreshMaxAge = env.API_REFRESH_TTL_S * 1000;
  const redirectUri = `${env.API_PUBLIC_ORIGIN}/v1/auth/google/callback`;

  function setCsrfCookie(res: Response): string {
    const csrf = newCsrfToken();
    res.cookie(names.csrf, csrf, { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: refreshMaxAge });
    return csrf;
  }

  function setSessionCookies(res: Response, refreshToken: string): string {
    res.cookie(names.refresh, refreshToken, { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: refreshMaxAge });
    return setCsrfCookie(res);
  }

  function clearSessionCookies(res: Response) {
    res.clearCookie(names.refresh, clearCookieOptions());
    res.clearCookie(names.csrf, clearCookieOptions());
  }

  function sendSession(res: Response, session: IssuedSession, status = 200) {
    const csrfToken = setSessionCookies(res, session.refreshToken);
    res.setHeader("Cache-Control", "no-store");
    res.status(status).json({ accessToken: session.accessToken, tokenType: "Bearer", expiresIn: session.expiresIn, csrfToken, user: session.user });
  }

  function refreshCookie(req: Request): string {
    const value: unknown = req.cookies?.[names.refresh];
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{32,128}$/.test(value)) throw errors.invalidToken();
    return value;
  }

  return {
    /** Entrega un token CSRF nuevo solo a orígenes permitidos por CORS (tras recargar la web, por ejemplo). */
    csrf(_req: Request, res: Response) {
      res.setHeader("Cache-Control", "no-store");
      res.json({ csrfToken: setCsrfCookie(res) });
    },

    async register(req: Request, res: Response) {
      await auth.register(registerBody.parse(req.body), metaOf(req, res));
      res.status(202).json({ status: "pending_verification" });
    },

    async resendVerification(req: Request, res: Response) {
      await auth.resendVerification(emailBody.parse(req.body).email, metaOf(req, res));
      res.status(202).json({ status: "accepted" });
    },

    async verifyEmail(req: Request, res: Response) {
      await auth.verifyEmail(tokenBody.parse(req.body).token, metaOf(req, res));
      res.json({ status: "verified" });
    },

    async login(req: Request, res: Response) {
      const result = await auth.login(loginBody.parse(req.body), metaOf(req, res));
      if (result.kind === "mfa") {
        res.setHeader("Cache-Control", "no-store");
        res.json({ mfaRequired: true, mfaToken: result.mfaToken });
        return;
      }
      sendSession(res, result.session);
    },

    async loginMfa(req: Request, res: Response) {
      sendSession(res, await auth.completeMfa(mfaLoginBody.parse(req.body), metaOf(req, res)));
    },

    async refresh(req: Request, res: Response) {
      try {
        sendSession(res, await auth.refresh(refreshCookie(req), metaOf(req, res)));
      } catch (err) {
        clearSessionCookies(res);
        throw err;
      }
    },

    async logout(req: Request, res: Response) {
      const value: unknown = req.cookies?.[names.refresh];
      if (typeof value === "string") await auth.logout(value, metaOf(req, res));
      clearSessionCookies(res);
      res.status(204).end();
    },

    async forgotPassword(req: Request, res: Response) {
      await auth.forgotPassword(emailBody.parse(req.body).email, metaOf(req, res));
      res.status(202).json({ status: "accepted" });
    },

    async resetPassword(req: Request, res: Response) {
      await auth.resetPassword(resetBody.parse(req.body), metaOf(req, res));
      clearSessionCookies(res);
      res.json({ status: "password_updated" });
    },

    async googleStart(_req: Request, res: Response) {
      if (!deps.google) throw errors.unavailable("OAUTH_UNAVAILABLE");
      const start = deps.google.start(redirectUri);
      const payload = JSON.stringify({ state: start.state, verifier: start.verifier, nonce: start.nonce, exp: deps.now() + OAUTH_TTL_S * 1000 });
      const sealed = deps.cipher.encrypt(payload, OAUTH_AAD);
      res.cookie(names.oauth, sealed, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: OAUTH_TTL_S * 1000 });
      res.redirect(302, start.url);
    },

    async googleCallback(req: Request, res: Response) {
      const web = env.API_WEB_ORIGIN;
      const sealed: unknown = req.cookies?.[names.oauth];
      res.clearCookie(names.oauth, clearCookieOptions("lax"));
      try {
        if (!deps.google || typeof sealed !== "string") throw errors.invalidToken();
        const query = oauthCallbackQuery.parse(req.query);
        const flow = oauthFlow.parse(JSON.parse(deps.cipher.decrypt(sealed, OAUTH_AAD)));
        if (flow.exp <= deps.now() || flow.state !== query.state) throw errors.invalidToken();
        const identity = await deps.google.exchange(query.code, flow.verifier, redirectUri, flow.nonce);
        const result = await auth.loginWithGoogle(identity, metaOf(req, res));
        if (result.kind === "mfa") {
          res.redirect(302, `${web}/auth/callback#mfa=${encodeURIComponent(result.mfaToken)}`);
          return;
        }
        setSessionCookies(res, result.session.refreshToken);
        res.redirect(302, `${web}/auth/callback`);
      } catch (err) {
        deps.logger.warn({ err: (err as Error).message, requestId: res.locals.requestId }, "google oauth failed");
        res.redirect(302, `${web}/auth/login#error=oauth`);
      }
    },
  };
}
