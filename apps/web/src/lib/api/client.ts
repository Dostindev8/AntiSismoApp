import {
  AcceptedSchema,
  AccountErrorSchema,
  AuthPolicySchema,
  CsrfResponseSchema,
  LoginResponseSchema,
  MfaSetupSchema,
  PublicUserSchema,
  RecoveryCodesSchema,
  RevokeOthersSchema,
  SessionListSchema,
  SessionResponseSchema,
  type PublicUser,
  type SessionResponse,
} from "@antisismo/proto/account";
import type { z } from "zod";

/** El navegador solo habla con la web; Next reescribe /api/v1 hacia el API (ADR 0008). */
export const API_BASE = "/api/v1";
export const REFRESH_LOCK = "antisismo-auth-refresh";
const TIMEOUT_MS = 15_000;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface LockManagerLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

export interface AccountClientOptions {
  fetch?: typeof fetch;
  base?: string;
  /** `navigator.locks` cuando existe: serializa el refresh entre pestañas. */
  locks?: LockManagerLike | null;
  onSession?: (user: PublicUser | null) => void;
}

type Method = "GET" | "POST" | "PATCH" | "DELETE";
interface CallOptions<S extends z.ZodType | undefined> {
  method?: Method;
  body?: unknown;
  schema?: S;
  auth?: boolean;
  csrf?: string;
}
type Result<S> = S extends z.ZodType ? z.infer<S> : undefined;

export function createAccountClient(options: AccountClientOptions = {}) {
  const doFetch = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));
  const base = options.base ?? API_BASE;
  const locks = options.locks ?? null;
  let accessToken: string | null = null;
  let inflight: Promise<PublicUser> | null = null;

  function setSession(session: SessionResponse | null) {
    accessToken = session?.accessToken ?? null;
    options.onSession?.(session?.user ?? null);
  }

  async function raw<S extends z.ZodType | undefined>(path: string, opts: CallOptions<S>): Promise<Result<S>> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (opts.auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;
    if (opts.csrf) headers["X-CSRF-Token"] = opts.csrf;
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method: opts.method ?? "GET",
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        credentials: "same-origin",
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const timeout = err instanceof DOMException && err.name === "TimeoutError";
      throw new ApiError(0, timeout ? "TIMEOUT" : "NETWORK_ERROR", timeout ? "Request timed out" : "Network unavailable");
    }
    if (!res.ok) {
      const parsed = AccountErrorSchema.safeParse(await res.json().catch(() => null));
      if (parsed.success) throw new ApiError(res.status, parsed.data.code, parsed.data.message, parsed.data.requestId, parsed.data.details);
      throw new ApiError(res.status, res.status >= 500 ? "UNAVAILABLE" : `HTTP_${res.status}`, res.statusText || "Request failed");
    }
    if (!opts.schema || res.status === 204) return undefined as Result<S>;
    const parsed = opts.schema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new ApiError(res.status, "BAD_RESPONSE", "Unexpected response from server");
    return parsed.data as Result<S>;
  }

  function refreshOnce(): Promise<PublicUser> {
    inflight ??= (async () => {
      const run = async () => {
        const { csrfToken } = await raw("/auth/csrf", { schema: CsrfResponseSchema });
        return raw("/auth/refresh", { method: "POST", csrf: csrfToken, schema: SessionResponseSchema });
      };
      try {
        const session = locks ? await locks.request(REFRESH_LOCK, run) : await run();
        setSession(session);
        return session.user;
      } catch (err) {
        setSession(null);
        throw err;
      }
    })().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  async function call<S extends z.ZodType | undefined>(path: string, opts: CallOptions<S>): Promise<Result<S>> {
    if (opts.auth && !accessToken) await refreshOnce();
    try {
      return await raw(path, opts);
    } catch (err) {
      if (!opts.auth || !(err instanceof ApiError) || err.status !== 401) throw err;
      await refreshOnce();
      return raw(path, opts);
    }
  }

  return {
    get authenticated() {
      return accessToken !== null;
    },
    /** Restaura la sesión tras recargar (cookie HttpOnly + CSRF nuevo). */
    restore: refreshOnce,

    policy: () => raw("/auth/policy", { schema: AuthPolicySchema }),
    register: (body: { email: string; password: string; displayName?: string; locale: string; termsVersion: string }) =>
      raw("/auth/register", { method: "POST", body, schema: AcceptedSchema }),
    verifyEmail: (token: string) => raw("/auth/verify-email", { method: "POST", body: { token }, schema: AcceptedSchema }),
    resendVerification: (email: string) => raw("/auth/verify-email/resend", { method: "POST", body: { email }, schema: AcceptedSchema }),
    forgotPassword: (email: string) => raw("/auth/password/forgot", { method: "POST", body: { email }, schema: AcceptedSchema }),
    resetPassword: (token: string, password: string) =>
      raw("/auth/password/reset", { method: "POST", body: { token, password }, schema: AcceptedSchema }),

    async login(email: string, password: string): Promise<{ mfaToken: string } | { user: PublicUser }> {
      const res = await raw("/auth/login", { method: "POST", body: { email, password }, schema: LoginResponseSchema });
      if ("mfaRequired" in res) return { mfaToken: res.mfaToken };
      setSession(res);
      return { user: res.user };
    },
    async loginMfa(mfaToken: string, code: string): Promise<PublicUser> {
      const res = await raw("/auth/login/mfa", { method: "POST", body: { mfaToken, code }, schema: SessionResponseSchema });
      setSession(res);
      return res.user;
    },
    async logout(): Promise<void> {
      try {
        const { csrfToken } = await raw("/auth/csrf", { schema: CsrfResponseSchema });
        await raw("/auth/logout", { method: "POST", csrf: csrfToken });
      } finally {
        setSession(null);
      }
    },
    /** Limpia el estado local sin llamar al API (otra pestaña ya cerró sesión). */
    forget: () => setSession(null),

    /** Perfil actual; también refresca el usuario publicado a la UI (p. ej. tras activar MFA). */
    async me(): Promise<PublicUser> {
      const user = await call("/me", { auth: true, schema: PublicUserSchema });
      options.onSession?.(user);
      return user;
    },
    sessions: () => call("/me/sessions", { auth: true, schema: SessionListSchema }),
    revokeSession: (id: string) => call(`/me/sessions/${encodeURIComponent(id)}`, { method: "DELETE", auth: true }),
    revokeOtherSessions: () => call("/me/sessions/revoke-others", { method: "POST", auth: true, schema: RevokeOthersSchema }),
    async acceptTerms(termsVersion: string): Promise<PublicUser> {
      const user = await call("/me/terms", { method: "POST", auth: true, body: { termsVersion }, schema: PublicUserSchema });
      options.onSession?.(user);
      return user;
    },
    mfaSetup: () => call("/me/mfa/setup", { method: "POST", auth: true, schema: MfaSetupSchema }),
    mfaEnable: (code: string) => call("/me/mfa/enable", { method: "POST", auth: true, body: { code }, schema: RecoveryCodesSchema }),
    mfaDisable: (password: string, code: string) => call("/me/mfa/disable", { method: "POST", auth: true, body: { password, code } }),
  };
}

export type AccountClient = ReturnType<typeof createAccountClient>;
