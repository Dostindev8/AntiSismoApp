import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";

import { type Locale, routing } from "./routing";

const loaders: Record<Locale, () => Promise<{ default: Record<string, unknown> }>> = {
  "es-DO": () => import("@antisismo/config/web-messages/es-DO.json"),
  en: () => import("@antisismo/config/web-messages/en.json"),
  fr: () => import("@antisismo/config/web-messages/fr.json"),
  pt: () => import("@antisismo/config/web-messages/pt.json"),
};

/** Zona horaria solo de presentación (los datos viajan en epoch ms UTC). */
export const PRESENTATION_TIME_ZONE = "America/Santo_Domingo";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale: Locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  return {
    locale,
    messages: (await loaders[locale]()).default,
    timeZone: PRESENTATION_TIME_ZONE,
    formats: {
      dateTime: {
        short: { day: "2-digit", month: "2-digit", year: "numeric" },
        time: { hour: "numeric", minute: "2-digit", hour12: true },
      },
    },
  };
});
