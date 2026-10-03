import { z } from "zod";

const origin = z.url({ protocol: /^https?$/ });

function isLoopback(url: string): boolean {
  return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname);
}

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    NEXT_PUBLIC_API_ORIGIN: origin.optional(),
    /** Origen del API visto desde el servidor de Next (solo servidor; el navegador usa /api/v1 en la misma origen). */
    API_INTERNAL_ORIGIN: origin.optional(),
  })
  .refine((e) => e.NODE_ENV !== "production" || !e.NEXT_PUBLIC_API_ORIGIN?.startsWith("http:"), {
    message: "NEXT_PUBLIC_API_ORIGIN debe ser https en producción",
    path: ["NEXT_PUBLIC_API_ORIGIN"],
  })
  .refine((e) => e.NODE_ENV !== "production" || !e.API_INTERNAL_ORIGIN?.startsWith("http:") || isLoopback(e.API_INTERNAL_ORIGIN), {
    message: "API_INTERNAL_ORIGIN debe ser https en producción (http solo hacia loopback, que no sale del host)",
    path: ["API_INTERNAL_ORIGIN"],
  });

export type WebEnv = z.infer<typeof schema>;

/** Valida el entorno; lanza al arrancar si es inválido (la app no inicia con configuración insegura). */
export function parseEnv(source: Record<string, string | undefined>): WebEnv {
  const parsed = schema.parse({
    NODE_ENV: source.NODE_ENV,
    NEXT_PUBLIC_API_ORIGIN: source.NEXT_PUBLIC_API_ORIGIN || undefined,
    API_INTERNAL_ORIGIN: source.API_INTERNAL_ORIGIN || undefined,
  });
  if (parsed.API_INTERNAL_ORIGIN) parsed.API_INTERNAL_ORIGIN = parsed.API_INTERNAL_ORIGIN.replace(/\/+$/, "");
  else delete parsed.API_INTERNAL_ORIGIN;
  if (!parsed.NEXT_PUBLIC_API_ORIGIN) delete parsed.NEXT_PUBLIC_API_ORIGIN;
  return parsed;
}

/** Reglas de reescritura same-origin (ADR 0008). Sin API configurado no se reescribe y la UI muestra estado degradado. */
export function apiRewrites(e: WebEnv): Array<{ source: string; destination: string }> {
  if (!e.API_INTERNAL_ORIGIN) return [];
  return [{ source: "/api/v1/:path*", destination: `${e.API_INTERNAL_ORIGIN}/v1/:path*` }];
}

export const env = parseEnv(process.env);
