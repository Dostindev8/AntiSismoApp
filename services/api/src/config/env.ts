import { z } from "zod";

const csvUrls = z
  .string()
  .default("")
  .transform((raw) => raw.split(",").map((s) => s.trim()).filter(Boolean))
  .pipe(z.array(z.url({ protocol: /^https?$/ })));

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const int = (def: number, min: number, max: number) => z.coerce.number().int().min(min).max(max).default(def);

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    API_PORT: int(8080, 1, 65535),
    API_TRUST_PROXY: z.string().default("loopback"),
    API_PUBLIC_ORIGIN: z.url({ protocol: /^https?$/ }).default("http://localhost:8080"),
    API_WEB_ORIGIN: z.url({ protocol: /^https?$/ }).default("http://localhost:3000"),
    API_CORS_ORIGINS: csvUrls,
    API_MONGO_URI: z.string().min(1).optional(),
    API_REDIS_URL: z.string().min(1).optional(),
    API_JWT_ISSUER: z.string().min(1).default("antisismo-api"),
    API_JWT_AUDIENCE: z.string().min(1).default("antisismo-web"),
    API_JWT_KID: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/).default("api-dev"),
    API_JWT_PRIVATE_KEY_PATH: z.string().min(1).optional(),
    API_JWT_PUBLIC_KEY_PATH: z.string().min(1).optional(),
    API_FIELD_KEY_B64: z.string().optional(),
    API_ACCESS_TTL_S: int(900, 60, 3600),
    API_REFRESH_TTL_S: int(2_592_000, 3600, 7_776_000),
    API_MFA_TOKEN_TTL_S: int(300, 60, 900),
    API_PASSWORD_MIN: int(12, 12, 64),
    API_PASSWORD_MAX: int(128, 64, 1024),
    API_HIBP_ENABLED: bool.default(true),
    API_HIBP_TIMEOUT_MS: int(1500, 200, 10_000),
    API_LOCKOUT_THRESHOLD: int(5, 3, 20),
    API_LOCKOUT_BASE_MS: int(60_000, 1000, 3_600_000),
    API_LOCKOUT_MAX_MS: int(3_600_000, 60_000, 86_400_000),
    API_RATE_WINDOW_MS: int(60_000, 1000, 3_600_000),
    API_RATE_MAX: int(300, 10, 100_000),
    API_RATE_AUTH_WINDOW_MS: int(900_000, 1000, 86_400_000),
    API_RATE_AUTH_MAX: int(30, 3, 10_000),
    API_VERIFY_TTL_S: int(86_400, 600, 604_800),
    API_RESET_TTL_S: int(1800, 300, 86_400),
    API_AUDIT_RETENTION_DAYS: int(365, 30, 3650),
    API_MAIL_FROM: z.string().min(3).default("AntiSismo <no-reply@antisismo.app>"),
    API_GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    API_GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== "production") return;
    const require = (key: keyof typeof env, why: string) => {
      if (!env[key]) ctx.addIssue({ code: "custom", path: [key], message: why });
    };
    require("API_MONGO_URI", "obligatorio en producción");
    require("API_JWT_PRIVATE_KEY_PATH", "clave EdDSA obligatoria en producción");
    require("API_JWT_PUBLIC_KEY_PATH", "clave EdDSA obligatoria en producción");
    require("API_FIELD_KEY_B64", "clave AES-256-GCM obligatoria en producción");
    for (const key of ["API_PUBLIC_ORIGIN", "API_WEB_ORIGIN"] as const) {
      if (!env[key].startsWith("https://")) ctx.addIssue({ code: "custom", path: [key], message: "https obligatorio" });
    }
    if (env.API_CORS_ORIGINS.some((o) => !o.startsWith("https://"))) {
      ctx.addIssue({ code: "custom", path: ["API_CORS_ORIGINS"], message: "https obligatorio" });
    }
  });

export type Env = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const env = schema.parse(source);
  if (env.API_CORS_ORIGINS.length === 0) env.API_CORS_ORIGINS = [env.API_WEB_ORIGIN];
  return env;
}
