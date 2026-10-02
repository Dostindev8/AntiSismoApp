import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { CircuitBreaker, resilientFetch } from "../lib/resilience.js";

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_HOST = "oauth2.googleapis.com";
export const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
}

export interface PkceStart {
  url: string;
  state: string;
  verifier: string;
  nonce: string;
}

export interface GoogleClient {
  start(redirectUri: string): PkceStart;
  exchange(code: string, verifier: string, redirectUri: string, expectedNonce: string): Promise<GoogleIdentity>;
}

export interface GoogleClientOptions {
  clientId: string;
  clientSecret: string;
  jwks?: JWTVerifyGetKey;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const b64url = (buf: Buffer) => buf.toString("base64url");

export function createGoogleClient(opts: GoogleClientOptions): GoogleClient {
  const jwks = opts.jwks ?? createRemoteJWKSet(new URL(GOOGLE_JWKS_URL), { timeoutDuration: opts.timeoutMs ?? 3000 });
  const breaker = new CircuitBreaker(5, 30_000);
  return {
    start(redirectUri) {
      const state = b64url(randomBytes(24));
      const verifier = b64url(randomBytes(48));
      const nonce = b64url(randomBytes(24));
      const challenge = b64url(createHash("sha256").update(verifier).digest());
      const params = new URLSearchParams({
        client_id: opts.clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid email profile",
        state,
        nonce,
        code_challenge: challenge,
        code_challenge_method: "S256",
        prompt: "select_account",
      });
      return { url: `${GOOGLE_AUTH_URL}?${params.toString()}`, state, verifier, nonce };
    },
    async exchange(code, verifier, redirectUri, expectedNonce) {
      const res = await resilientFetch(
        `https://${GOOGLE_TOKEN_HOST}/token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            code_verifier: verifier,
            redirect_uri: redirectUri,
            client_id: opts.clientId,
            client_secret: opts.clientSecret,
          }),
        },
        { allowHosts: [GOOGLE_TOKEN_HOST], timeoutMs: opts.timeoutMs ?? 3000, retries: 1, baseDelayMs: 200, breaker, ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}) },
      );
      if (!res.ok) throw new Error(`token endpoint ${res.status}`);
      const body = (await res.json()) as { id_token?: unknown };
      if (typeof body.id_token !== "string") throw new Error("id_token ausente");
      const { payload } = await jwtVerify(body.id_token, jwks, { issuer: GOOGLE_ISSUERS, audience: opts.clientId, algorithms: ["RS256"] });
      if (payload.nonce !== expectedNonce) throw new Error("nonce inválido");
      if (typeof payload.sub !== "string" || typeof payload.email !== "string") throw new Error("claims incompletos");
      return {
        sub: payload.sub,
        email: payload.email.toLowerCase(),
        emailVerified: payload.email_verified === true,
        name: typeof payload.name === "string" ? payload.name.slice(0, 80) : null,
      };
    },
  };
}
