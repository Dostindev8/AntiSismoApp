import { z } from "zod";

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    NEXT_PUBLIC_API_ORIGIN: z.url({ protocol: /^https?$/ }).optional(),
  })
  .refine((e) => e.NODE_ENV !== "production" || !e.NEXT_PUBLIC_API_ORIGIN?.startsWith("http:"), {
    message: "NEXT_PUBLIC_API_ORIGIN debe ser https en producción",
    path: ["NEXT_PUBLIC_API_ORIGIN"],
  });

export type WebEnv = z.infer<typeof schema>;

/** Valida el entorno; lanza al arrancar si es inválido (la app no inicia con configuración insegura). */
export function parseEnv(source: Record<string, string | undefined>): WebEnv {
  return schema.parse({
    NODE_ENV: source.NODE_ENV,
    NEXT_PUBLIC_API_ORIGIN: source.NEXT_PUBLIC_API_ORIGIN || undefined,
  });
}

export const env = parseEnv(process.env);
