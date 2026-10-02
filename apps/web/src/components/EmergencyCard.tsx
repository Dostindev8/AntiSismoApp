import { getFormatter, getTranslations } from "next-intl/server";

import { dominicanContacts, primaryContact, telHref } from "@/lib/emergency";

import { Icon } from "./Icon";

export async function EmergencyCard() {
  const t = await getTranslations("emergency");
  const format = await getFormatter();
  const c = primaryContact(dominicanContacts);
  return (
    <section id="emergencia" aria-labelledby="emergencia-titulo" className="scroll-mt-24">
      <h2 id="emergencia-titulo" className="mb-3 font-display text-2xl font-bold">
        {t("title")}
      </h2>
      <div className="rounded-[20px] border border-white/10 bg-surface p-5 shadow-xl shadow-black/30 sm:p-6">
        <a
          href={telHref(c.number)}
          className="flex min-h-24 items-center gap-4 rounded-2xl bg-alert-red-strong px-5 py-4 text-text-primary shadow-lg shadow-alert-red/25 hover:brightness-110"
        >
          <span className="grid size-14 shrink-0 place-items-center rounded-full border-2 border-white/40">
            <Icon name="phone" className="size-7" />
          </span>
          <span className="flex flex-col">
            <span className="tabular font-display text-4xl font-extrabold leading-none">{c.number}</span>
            <span className="mt-1 text-lg font-semibold">{t("call", { number: c.number })}</span>
          </span>
        </a>
        <p className="mt-3 text-sm text-text-muted">{t("callHint")}</p>
        <p className="mt-4 text-sm text-text-muted">
          {t("verified", { source: c.source_name })} ·{" "}
          {t("verifiedAt", { date: format.dateTime(new Date(c.verified_at), "short") })}
        </p>
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-white/15 p-3 text-sm">
          <Icon name="info" className="mt-0.5 size-5 shrink-0 text-accent-cyan" />
          {t("disclaimer")}
        </p>
      </div>
    </section>
  );
}
