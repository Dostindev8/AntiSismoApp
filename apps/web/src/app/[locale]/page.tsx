import { getTranslations, setRequestLocale } from "next-intl/server";

import { BrandLogo } from "@/components/BrandLogo";
import { EmergencyCard } from "@/components/EmergencyCard";
import { Icon, type IconName } from "@/components/Icon";
import type { Locale } from "@/i18n/routing";

const FEATURES = [
  ["realtime", "wave"],
  ["maps", "pin"],
  ["safeSites", "shield"],
  ["multiHazard", "globe"],
] as const satisfies ReadonlyArray<readonly [string, IconName]>;

const BENEFITS = [
  ["home", "home"],
  ["family", "users"],
  ["community", "community"],
  ["future", "handshake"],
] as const satisfies ReadonlyArray<readonly [string, IconName]>;

export default async function HomePage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  return (
    <div className="flex flex-col gap-12">
      <section aria-labelledby="hero-titulo" className="grid items-center gap-8 md:grid-cols-[auto_1fr]">
        <BrandLogo alt={t("brand.logoAlt")} height={140} priority />
        <div>
          <h1 id="hero-titulo" className="font-display text-[length:var(--text-fluid-h1)] font-extrabold leading-tight">
            {t("brand.slogan")}
          </h1>
          <p className="mt-3 max-w-xl text-lg text-text-muted">{t("home.lead")}</p>
          <p className="mt-5 inline-flex items-start gap-2 rounded-2xl border border-warn-amber/40 bg-warn-amber/10 p-3 text-sm">
            <span className="rounded-md bg-warn-amber px-2 py-0.5 text-xs font-bold uppercase text-brand-navy">
              {t("preview.badge")}
            </span>
            <span>{t("preview.body")}</span>
          </p>
        </div>
      </section>

      <EmergencyCard />

      <section aria-labelledby="funciones-titulo">
        <h2 id="funciones-titulo" className="mb-4 font-display text-2xl font-bold">
          {t("home.featuresTitle")}
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(([key, icon]) => (
            <li key={key} className="rounded-[20px] border border-white/10 bg-surface p-5">
              <span className="mb-3 grid size-12 place-items-center rounded-full border border-accent-cyan/40 bg-surface-high text-accent-cyan">
                <Icon name={icon} />
              </span>
              <h3 className="font-semibold">{t(`home.features.${key}.title`)}</h3>
              <p className="mt-1 text-sm text-text-muted">{t(`home.features.${key}.body`)}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="honestidad-titulo" className="rounded-[20px] border border-white/10 bg-surface p-5">
        <h2 id="honestidad-titulo" className="flex items-center gap-2 font-semibold">
          <Icon name="shield" className="size-6 text-safe-green" />
          {t("home.honestyTitle")}
        </h2>
        <p className="mt-2 text-text-muted">{t("home.honestyBody")}</p>
      </section>

      <section aria-labelledby="beneficios-titulo">
        <h2 id="beneficios-titulo" className="mb-4 font-display text-2xl font-bold">
          {t("home.benefitsTitle")}
        </h2>
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {BENEFITS.map(([key, icon]) => (
            <li key={key} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-surface/70 p-4">
              <Icon name={icon} className="size-7 shrink-0 text-accent-cyan" />
              <span className="text-sm font-medium">{t(`home.benefits.${key}`)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
