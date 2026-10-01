import { getTranslations } from "next-intl/server";

export async function SiteFooter() {
  const t = await getTranslations();
  return (
    <footer className="mt-16 border-t border-white/10 bg-bg-deep/80">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 text-sm text-text-muted">
        <p className="font-display text-base font-bold text-text-primary">{t("brand.closing")}</p>
        <p>{t("footer.sources")}</p>
        <p>{t("footer.rights", { year: new Date().getUTCFullYear() })}</p>
      </div>
    </footer>
  );
}
