import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

const VERSION = "v1";

export interface FieldCipher {
  encrypt(plain: string, aad: string): string;
  decrypt(payload: string, aad: string): string;
  /** HMAC-SHA256 determinista para indexar/pseudonimizar sin revelar el valor (p. ej. IP en auditoría). */
  blindIndex(value: string): string;
}

export function createFieldCipher(key: Buffer): FieldCipher {
  if (key.length !== 32) throw new Error("La clave de campo debe tener 32 bytes (AES-256)");
  const macKey = createHmac("sha256", key).update("antisismo/blind-index").digest();
  return {
    encrypt(plain, aad) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(aad, "utf8"));
      const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
    },
    decrypt(payload, aad) {
      const [version, iv, tag, ct] = payload.split(".");
      if (version !== VERSION || !iv || !tag || ct === undefined) throw new Error("Formato cifrado inválido");
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
      decipher.setAAD(Buffer.from(aad, "utf8"));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
    },
    blindIndex(value) {
      return createHmac("sha256", macKey).update(value).digest("base64url");
    },
  };
}

export function parseFieldKey(b64: string): Buffer {
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) throw new Error("API_FIELD_KEY_B64 debe decodificar a 32 bytes");
  return key;
}
