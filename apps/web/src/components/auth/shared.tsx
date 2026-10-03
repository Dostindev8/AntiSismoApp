"use client";

import type { AuthPolicy } from "@antisismo/proto/account";
import { useTranslations } from "next-intl";
import { useCallback, useState, type ReactNode } from "react";

import { Link } from "@/i18n/navigation";
import { errorKey } from "@/lib/auth/helpers";
import { usePolicy } from "@/lib/hooks";

import { FormAlert } from "../forms/FormAlert";
import { linkClass, secondaryButtonClass } from "../forms/SubmitButton";
import { useAuth } from "./AuthProvider";

type ErrorCode = Parameters<ReturnType<typeof useTranslations<"errors">>>[0];

/** Texto localizado para cualquier error (los códigos desconocidos caen en GENERIC, sin filtrar detalles del servidor). */
export function useErrorText(): (err: unknown) => string {
  const t = useTranslations("errors");
  return useCallback((err: unknown) => t(errorKey(err) as ErrorCode), [t]);
}

export function AuthCard({ title, lead, children }: { title: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby="auth-title" className="mx-auto flex w-full max-w-md flex-col gap-5 rounded-[20px] border border-white/10 bg-surface p-5 sm:p-8">
      <header className="flex flex-col gap-2">
        <h1 id="auth-title" className="font-display text-2xl font-bold sm:text-3xl">
          {title}
        </h1>
        {lead ? <p className="text-text-muted">{lead}</p> : null}
      </header>
      {children}
    </section>
  );
}

/** Carga la política pública del API y cubre sus estados (cargando / error con reintento). */
export function PolicyGate({ children }: { children: (policy: AuthPolicy) => ReactNode }) {
  const { client } = useAuth();
  const [attempt, setAttempt] = useState(0);
  return <PolicyLoader key={attempt} client={client} onRetry={() => setAttempt((a) => a + 1)} render={children} />;
}

function PolicyLoader({
  client,
  onRetry,
  render,
}: {
  client: ReturnType<typeof useAuth>["client"];
  onRetry: () => void;
  render: (policy: AuthPolicy) => ReactNode;
}) {
  const t = useTranslations();
  const errorText = useErrorText();
  const state = usePolicy(client);
  if (state.status === "loading") {
    return (
      <p role="status" className="text-text-muted">
        {t("auth.policyLoading")}
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <div className="flex flex-col gap-3">
        <FormAlert tone="error" focus={false}>
          {errorText(state.error)}
        </FormAlert>
        <button type="button" onClick={onRetry} className={secondaryButtonClass}>
          {t("states.retry")}
        </button>
      </div>
    );
  }
  return <>{render(state.policy)}</>;
}

/** Enlace a una página legal en pestaña nueva (no se pierde lo escrito en el formulario). */
export function LegalLink({ href, children }: { href: string; children: ReactNode }) {
  const t = useTranslations("a11y");
  return (
    <Link href={href} className={linkClass} target="_blank" rel="noopener">
      {children}
      <span className="sr-only"> {t("external")}</span>
    </Link>
  );
}

export function OfflineNotice() {
  const t = useTranslations("forms");
  return <FormAlert tone="info">{t("offline")}</FormAlert>;
}
