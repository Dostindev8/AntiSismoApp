import createMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";

import { routing } from "./i18n/routing";
import { env } from "./lib/env";
import { buildCsp } from "./lib/security-headers";

const handleI18n = createMiddleware(routing);

export default function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp({ nonce, dev: env.NODE_ENV !== "production", apiOrigin: env.NEXT_PUBLIC_API_ORIGIN });
  request.headers.set("x-nonce", nonce);
  request.headers.set("content-security-policy", csp);
  const response = handleI18n(request);
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
