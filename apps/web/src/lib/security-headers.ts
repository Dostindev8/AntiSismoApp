export type Header = { key: string; value: string };

/** Cabeceras estáticas para toda respuesta. La CSP va aparte porque lleva un nonce por petición. */
export function staticSecurityHeaders(production: boolean): Header[] {
  const headers: Header[] = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
    {
      key: "Permissions-Policy",
      value: "geolocation=(self), camera=(), microphone=(), payment=(), usb=(), interest-cohort=()",
    },
  ];
  if (production) {
    headers.push({ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" });
  }
  return headers;
}

export type CspOptions = { nonce: string; dev: boolean; apiOrigin?: string | undefined };

/**
 * CSP estricta con nonce: sin 'unsafe-inline' en scripts. `style-src-attr 'unsafe-inline'` es necesario
 * para atributos style que emite React/next/image en el HTML del servidor (riesgo residual bajo: no
 * permite ejecutar código). En desarrollo se añade 'unsafe-eval' y ws: para el recargado en caliente.
 */
export function buildCsp({ nonce, dev, apiOrigin }: CspOptions): string {
  if (!/^[A-Za-z0-9+/=]{16,}$/.test(nonce)) throw new Error("nonce inválido");
  const connect = ["'self'"];
  if (apiOrigin) connect.push(new URL(apiOrigin).origin);
  if (dev) connect.push("ws:");
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", `'nonce-${nonce}'`],
    "style-src-attr": ["'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'"],
    "connect-src": connect,
    "worker-src": ["'self'"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  const parts = Object.entries(directives).map(([k, v]) => `${k} ${v.join(" ")}`);
  if (!dev) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}
