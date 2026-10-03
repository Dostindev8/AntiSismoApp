"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { useRouter } from "@/i18n/navigation";
import { tokenFromHash } from "@/lib/auth/helpers";
import { useFragmentOnce } from "@/lib/hooks";

import { FormAlert } from "../forms/FormAlert";
import { useAuth } from "./AuthProvider";
import { nextFromLocation } from "./LoginForm";
import { MfaStep } from "./MfaStep";
import { AuthCard, useErrorText } from "./shared";

/** Destino del flujo Google: el API ya fijó la cookie de refresh (o pide MFA en `#mfa=`). */
export function OAuthCallback() {
  const t = useTranslations("auth");
  const router = useRouter();
  const { client } = useAuth();
  const errorText = useErrorText();
  const fragment = useFragmentOnce();
  const mfaToken = fragment === null ? null : tokenFromHash(fragment, "mfa");
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (fragment === null || mfaToken || started.current) return;
    started.current = true;
    client.restore().then(
      () => router.replace(nextFromLocation()),
      (err: unknown) => setError(errorText(err)),
    );
  }, [client, router, errorText, fragment, mfaToken]);

  return (
    <AuthCard title={t("callback.title")}>
      {mfaToken ? (
        <MfaStep mfaToken={mfaToken} onDone={() => router.replace(nextFromLocation())} onCancel={() => router.replace("/auth/login")} />
      ) : error ? (
        <FormAlert tone="error">{error}</FormAlert>
      ) : (
        <p role="status" className="text-text-muted">
          {t("callback.title")}
        </p>
      )}
    </AuthCard>
  );
}
