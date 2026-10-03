import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

import { apiRewrites, env } from "./src/lib/env";
import { staticSecurityHeaders } from "./src/lib/security-headers";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: staticSecurityHeaders(process.env.NODE_ENV === "production") }];
  },
  async rewrites() {
    // beforeFiles: con API configurado, la reescritura gana a la ruta de respaldo /api/v1 (que responde 503 JSON).
    return { beforeFiles: apiRewrites(env), afterFiles: [], fallback: [] };
  },
};

export default withNextIntl(config);
