import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["es-DO", "en", "fr", "pt"],
  defaultLocale: "es-DO",
  localePrefix: "as-needed",
});

export type Locale = (typeof routing.locales)[number];
