import { SignJWT, generateKeyPair } from "jose";
import { describe, expect, it } from "vitest";
import { createTokenService, hashToken, loadKeys, newOpaqueToken } from "./tokens.js";

async function service(audience = "antisismo-web") {
  const keys = await loadKeys();
  return { keys, svc: createTokenService({ ...keys, kid: "k-test", issuer: "antisismo-api", audience, accessTtlS: 900 }) };
}

describe("tokens EdDSA", () => {
  it("firma y verifica access tokens con claims tipados", async () => {
    const { svc } = await service();
    const jwt = await svc.signAccess({ sub: "u1", sid: "s1", roles: ["user"], mfa: false });
    expect(JSON.parse(Buffer.from(jwt.split(".")[0] ?? "", "base64url").toString())).toMatchObject({ alg: "EdDSA", kid: "k-test", typ: "at+jwt" });
    await expect(svc.verifyAccess(jwt)).resolves.toEqual({ sub: "u1", sid: "s1", roles: ["user"], mfa: false });
  });

  it("rechaza otra audiencia, otra clave, alg none y roles desconocidos", async () => {
    const { svc } = await service();
    const { svc: otherAud } = await service("otra");
    const jwt = await svc.signAccess({ sub: "u1", sid: "s1", roles: ["user"], mfa: false });
    await expect(otherAud.verifyAccess(jwt)).rejects.toThrow();
    const none = `${Buffer.from('{"alg":"none","typ":"at+jwt"}').toString("base64url")}.${jwt.split(".")[1]}.`;
    await expect(svc.verifyAccess(none)).rejects.toThrow();

    const { keys } = await service();
    const forged = await new SignJWT({ sid: "s1", roles: ["superuser"], typ: "access" })
      .setProtectedHeader({ alg: "EdDSA", typ: "at+jwt" })
      .setSubject("u1")
      .setIssuer("antisismo-api")
      .setAudience("antisismo-web")
      .setExpirationTime("5m")
      .sign(keys.privateKey);
    await expect(svc.verifyAccess(forged)).rejects.toThrow();
  });

  it("un token de propósito no sirve como access token ni para otro propósito", async () => {
    const { svc } = await service();
    const mfa = await svc.signPurpose("mfa", "u1", 300);
    await expect(svc.verifyPurpose("mfa", mfa)).resolves.toMatchObject({ sub: "u1" });
    await expect(svc.verifyPurpose("oauth", mfa)).rejects.toThrow();
    await expect(svc.verifyAccess(mfa)).rejects.toThrow();
  });

  it("JWKS expone solo la clave pública", async () => {
    const { svc } = await service();
    const { keys } = await svc.jwks();
    expect(keys[0]).toMatchObject({ kty: "OKP", crv: "Ed25519", kid: "k-test", alg: "EdDSA", use: "sig" });
    expect(keys[0]).not.toHaveProperty("d");
  });

  it("tokens opacos: 256 bits, solo se persiste el hash", async () => {
    const { token, hash } = newOpaqueToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toBe(hashToken(token));
    expect(hash).not.toContain(token);
    expect(newOpaqueToken().token).not.toBe(token);
    expect((await generateKeyPair("EdDSA", { crv: "Ed25519" })).publicKey).toBeDefined();
  });
});
