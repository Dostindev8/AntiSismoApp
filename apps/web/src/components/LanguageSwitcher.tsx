"use client";

import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";

import { usePathname, useRouter } from "@/i18n/navigation";
import { type Locale, routing } from "@/i18n/routing";

import { Icon } from "./Icon";

export function LanguageSwitcher() {
  const t = useTranslations("language");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  return (
    <label className="relative inline-flex min-h-11 items-center gap-2 rounded-full border border-white/15 bg-surface/80 pl-3 pr-2 text-sm">
      <Icon name="globe" className="size-5 text-accent-cyan" />
      <span className="sr-only">{t("label")}</span>
      <select
        value={locale}
        disabled={pending}
        aria-label={t("label")}
        onChange={(e) => {
          const next = e.target.value as Locale;
          startTransition(() => router.replace(pathname, { locale: next }));
        }}
        className="min-h-11 cursor-pointer appearance-none bg-transparent pr-2 font-medium text-text-primary outline-none"
      >
        {routing.locales.map((l) => (
          <option key={l} value={l} lang={l} className="bg-brand-navy">
            {t(l)}
          </option>
        ))}
      </select>
    </label>
  );
}
