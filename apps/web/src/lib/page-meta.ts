import type { Metadata } from "next";
import type { MessageKeys, Messages, NestedKeyOf } from "next-intl";
import { getTranslations } from "next-intl/server";

type TitleKey = MessageKeys<Messages, NestedKeyOf<Messages>>;

/** Metadatos de pantallas privadas o de un solo uso: título localizado, fuera de buscadores y sin Referer. */
export function privatePageMetadata(key: TitleKey) {
  return async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
    const { locale } = await params;
    const t = await getTranslations({ locale: locale as never });
    return {
      title: `${t(key)} · ${t("brand.name")}`,
      robots: { index: false, follow: false, nocache: true },
      referrer: "no-referrer",
    };
  };
}
