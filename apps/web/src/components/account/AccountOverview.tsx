"use client";

import type { AuthPolicy } from "@antisismo/proto/account";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Link, useRouter } from "@/i18n/navigation";

import { useAuth } from "../auth/AuthProvider";
import { LegalLink, useErrorText } from "../auth/shared";
import { FormAlert } from "../forms/FormAlert";
import { dangerButtonClass, secondaryButtonClass } from "../forms/SubmitButton";
import { Icon } from "../Icon";
import { buttonClass } from "../StateMessage";

export function AccountOverview() {
  const t = useTranslations("account");
  const tAuth = useTranslations("auth");
  const router = useRouter();
  const { user, client, signOut } = useAuth();
  const [policy, setPolicy] = useState<AuthPolicy | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let alive = true;
    client.policy().then(
      (p) => alive && setPolicy(p),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [client]);

  if (!user) return null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <h1 className="font-display text-3xl font-bold">{t("title")}</h1>
      {policy && user.termsVersion !== policy.termsVersion ? <TermsNotice version={policy.termsVersion} /> : null}
      <section aria-labelledby="profile-title" className="flex flex-col gap-3 rounded-[20px] border border-white/10 bg-surface p-5 sm:p-6">
        <h2 id="profile-title" className="font-display text-xl font-bold">
          {t("profile")}
        </h2>
        <dl className="flex flex-col gap-2">
          {user.displayName ? (
            <div className="flex items-center gap-2">
              <dt className="sr-only">{tAuth("displayName")}</dt>
              <dd className="flex items-center gap-2 font-semibold">
                <Icon name="user" className="size-5 text-accent-cyan" />
                {user.displayName}
              </dd>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <dt className="sr-only">{tAuth("email")}</dt>
            <dd className="flex items-center gap-2 break-all">
              <Icon name="mail" className="size-5 shrink-0 text-accent-cyan" />
              {user.email}
            </dd>
            <dd className={`rounded-full px-2 py-0.5 text-sm ${user.emailVerified ? "bg-safe-green-strong" : "bg-surface-high"}`}>
              {user.emailVerified ? t("emailVerified") : t("emailUnverified")}
            </dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="sr-only">{t("security")}</dt>
            <dd className="flex items-center gap-2">
              <Icon name="shield" className={`size-5 ${user.mfaEnabled ? "text-safe-green" : "text-warn-amber"}`} />
              {user.mfaEnabled ? t("mfaOn") : t("mfaOff")}
            </dd>
          </div>
        </dl>
      </section>
      <nav aria-label={t("title")} className="grid gap-3 sm:grid-cols-2">
        <Link href="/account/security" className={`${secondaryButtonClass} justify-start gap-2 rounded-2xl py-3`}>
          <Icon name="lock" className="size-5" />
          {t("security")}
        </Link>
        <Link href="/account/sessions" className={`${secondaryButtonClass} justify-start gap-2 rounded-2xl py-3`}>
          <Icon name="devices" className="size-5" />
          {t("sessions")}
        </Link>
      </nav>
      <button
        type="button"
        className={`${dangerButtonClass} self-start`}
        aria-disabled={signingOut}
        onClick={async () => {
          if (signingOut) return;
          setSigningOut(true);
          await signOut().catch(() => undefined);
          router.replace("/");
        }}
      >
        {t("signOut")}
      </button>
    </div>
  );
}

function TermsNotice({ version }: { version: string }) {
  const t = useTranslations("account");
  const { client } = useAuth();
  const errorText = useErrorText();
  const [state, setState] = useState<{ status: "idle" | "pending" | "done" } | { status: "error"; message: string }>({ status: "idle" });
  if (state.status === "done") return <FormAlert tone="success">{t("termsAccepted")}</FormAlert>;
  return (
    <section aria-labelledby="terms-title" className="flex flex-col gap-3 rounded-[20px] border border-warn-amber/60 bg-surface p-5">
      <h2 id="terms-title" className="font-display text-lg font-bold">
        {t("termsTitle")}
      </h2>
      <p>{t.rich("termsBody", {
          terms: (chunks) => <LegalLink href="/legal/terminos">{chunks}</LegalLink>,
          privacy: (chunks) => <LegalLink href="/legal/privacidad">{chunks}</LegalLink>,
          version,
        })}</p>
      {state.status === "error" ? <FormAlert tone="error">{state.message}</FormAlert> : null}
      <button
        type="button"
        className={`${buttonClass} self-start`}
        aria-disabled={state.status === "pending"}
        onClick={async () => {
          if (state.status === "pending") return;
          setState({ status: "pending" });
          try {
            await client.acceptTerms(version);
            setState({ status: "done" });
          } catch (err) {
            setState({ status: "error", message: errorText(err) });
          }
        }}
      >
        {t("termsAccept")}
      </button>
    </section>
  );
}
