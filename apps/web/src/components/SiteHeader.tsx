import Image from "next/image";
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";

import { AccountNav } from "./auth/AccountNav";
import { Icon } from "./Icon";
import { LanguageSwitcher } from "./LanguageSwitcher";

export async function SiteHeader() {
  const t = await getTranslations();
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-bg-deep/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="flex items-center gap-3 rounded-2xl" aria-label={`${t("brand.name")} — ${t("nav.home")}`}>
          <Image src="/brand/symbol.webp" alt="" width={176} height={192} priority className="h-11 w-auto object-contain" />
          <span className="hidden flex-col leading-tight min-[440px]:flex">
            <span className="font-display text-xl font-extrabold">
              Anti<span className="text-alert-red">Sismo</span>
            </span>
            <span className="hidden text-xs tracking-wide text-text-muted sm:block">{t("brand.tagline")}</span>
          </span>
        </Link>
        <nav aria-label={t("a11y.mainNav")} className="flex items-center gap-2">
          <LanguageSwitcher />
          <AccountNav />
          <a
            href="#emergencia"
            aria-label={t("nav.sosLabel")}
            className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-full bg-alert-red-strong px-4 font-bold text-text-primary shadow-lg shadow-alert-red/30 hover:brightness-110"
          >
            <Icon name="alert" className="size-5" />
            {t("nav.sos")}
          </a>
        </nav>
      </div>
    </header>
  );
}
