import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { SignJWT, exportJWK, generateKeyPair, importPKCS8, importSPKI, jwtVerify, type CryptoKey, type JWK } from "jose";
import { ROLES, type Role } from "../models/roles.js";

export interface AccessClaims {
  sub: string;
  sid: string;
  roles: Role[];
  mfa: boolean;
}

export interface TokenService {
  signAccess(claims: AccessClaims): Promise<string>;
  verifyAccess(token: string): Promise<AccessClaims>;
  signPurpose(purpose: string, sub: string, ttlS: number, extra?: Record<string, string>): Promise<string>;
  verifyPurpose(purpose: string, token: string): Promise<{ sub: string; extra: Record<string, string> }>;
  jwks(): Promise<{ keys: JWK[] }>;
}

export interface TokenConfig {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  kid: string;
  issuer: string;
  audience: string;
  accessTtlS: number;
}

const ALG = "EdDSA";

export async function loadKeys(privatePath?: string, publicPath?: string): Promise<{ privateKey: CryptoKey; publicKey: CryptoKey; ephemeral: boolean }> {
  if (privatePath && publicPath) {
    const [priv, pub] = await Promise.all([readFile(privatePath, "utf8"), readFile(publicPath, "utf8")]);
    return { privateKey: await importPKCS8(priv, ALG), publicKey: await importSPKI(pub, ALG), ephemeral: false };
  }
  const pair = await generateKeyPair(ALG, { crv: "Ed25519", extractable: true });
  return { ...pair, ephemeral: true };
}

function isRoleList(value: unknown): value is Role[] {
  return Array.isArray(value) && value.every((r) => typeof r === "string" && (ROLES as readonly string[]).includes(r));
}

export function createTokenService(cfg: TokenConfig): TokenService {
  const verifyOpts = { issuer: cfg.issuer, audience: cfg.audience, algorithms: [ALG], clockTolerance: 5 };
  return {
    async signAccess(claims) {
      return new SignJWT({ sid: claims.sid, roles: claims.roles, mfa: claims.mfa, typ: "access" })
        .setProtectedHeader({ alg: ALG, kid: cfg.kid, typ: "at+jwt" })
        .setSubject(claims.sub)
        .setIssuer(cfg.issuer)
        .setAudience(cfg.audience)
        .setIssuedAt()
        .setJti(randomUUID())
        .setExpirationTime(`${cfg.accessTtlS}s`)
        .sign(cfg.privateKey);
    },
    async verifyAccess(token) {
      const { payload } = await jwtVerify(token, cfg.publicKey, { ...verifyOpts, typ: "at+jwt" });
      if (payload.typ !== "access" || typeof payload.sub !== "string" || typeof payload.sid !== "string" || !isRoleList(payload.roles)) {
        throw new Error("Claims inválidos");
      }
      return { sub: payload.sub, sid: payload.sid, roles: payload.roles, mfa: payload.mfa === true };
    },
    async signPurpose(purpose, sub, ttlS, extra = {}) {
      return new SignJWT({ ...extra, typ: purpose })
        .setProtectedHeader({ alg: ALG, kid: cfg.kid })
        .setSubject(sub)
        .setIssuer(cfg.issuer)
        .setAudience(`${cfg.audience}:${purpose}`)
        .setIssuedAt()
        .setExpirationTime(`${ttlS}s`)
        .sign(cfg.privateKey);
    },
    async verifyPurpose(purpose, token) {
      const { payload } = await jwtVerify(token, cfg.publicKey, { ...verifyOpts, audience: `${cfg.audience}:${purpose}` });
      if (payload.typ !== purpose || typeof payload.sub !== "string") throw new Error("Propósito inválido");
      const extra: Record<string, string> = {};
      for (const [k, v] of Object.entries(payload)) if (typeof v === "string") extra[k] = v;
      return { sub: payload.sub, extra };
    },
    async jwks() {
      const jwk = await exportJWK(cfg.publicKey);
      return { keys: [{ ...jwk, kid: cfg.kid, alg: ALG, use: "sig" }] };
    },
  };
}

/** Token opaco de alta entropía; solo su SHA-256 se persiste. */
export function newOpaqueToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
