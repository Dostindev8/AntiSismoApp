import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

import { staticSecurityHeaders } from "./src/lib/security-headers";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: staticSecurityHeaders(process.env.NODE_ENV === "production") }];
  },
};

export default withNextIntl(config);
