"use client";

import type { AuthPolicy } from "@antisismo/proto/account";
import { useTranslations } from "next-intl";
import { useRef, useState, type FormEvent } from "react";

import { Link } from "@/i18n/navigation";
import { ApiError } from "@/lib/api/client";
import { passwordStrength, tokenFromHash } from "@/lib/auth/helpers";
import { focusFirstInvalid } from "@/lib/forms";
import { useFragmentOnce, useOnline } from "@/lib/hooks";

import { FormAlert } from "../forms/FormAlert";
import { PasswordField } from "../forms/PasswordField";
import { linkClass, SubmitButton } from "../forms/SubmitButton";
import { buttonClass } from "../StateMessage";
import { useAuth } from "./AuthProvider";
import { AuthCard, OfflineNotice, PolicyGate, useErrorText } from "./shared";

export function ResetForm() {
  const t = useTranslations("auth");
  const fragment = useFragmentOnce();
  const token = fragment === null ? undefined : tokenFromHash(fragment);

  return (
    <AuthCard title={t("reset.title")}>
      {token === undefined ? null : token === null ? (
        <>
          <FormAlert tone="error">{t("reset.missingToken")}</FormAlert>
          <Link href="/auth/forgot" className={`${linkClass} self-center py-2`}>
            {t("forgot.title")}
          </Link>
        </>
      ) : (
        <PolicyGate>{(policy) => <ResetFields token={token} policy={policy} />}</PolicyGate>
      )}
    </AuthCard>
  );
}

function ResetFields({ token, policy }: { token: string; policy: AuthPolicy }) {
  const t = useTranslations();
  const { client } = useAuth();
  const online = useOnline();
  const errorText = useErrorText();
  const formRef = useRef<HTMLFormElement>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setServerError(null);
    const strength = passwordStrength(password, { min: policy.password.min, max: policy.password.max });
    const problem = !password ? t("forms.required") : !strength.meetsPolicy ? t("errors.WEAK_PASSWORD") : null;
    setError(problem);
    if (problem) {
      requestAnimationFrame(() => focusFirstInvalid(formRef.current));
      return;
    }
    if (!online) return;
    setPending(true);
    try {
      await client.resetPassword(token, password);
      setPassword("");
      // El API revocó todas las sesiones: limpiamos también el estado local de esta pestaña.
      client.forget();
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError && (err.code === "WEAK_PASSWORD" || err.code === "BREACHED_PASSWORD")) {
        setError(errorText(err));
        requestAnimationFrame(() => focusFirstInvalid(formRef.current));
      } else setServerError(errorText(err));
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <>
        <FormAlert tone="success" focus>
          <p className="font-semibold">{t("auth.reset.doneTitle")}</p>
          <p>{t("auth.reset.doneBody")}</p>
        </FormAlert>
        <Link href="/auth/login" className={buttonClass}>
          {t("auth.login.title")}
        </Link>
      </>
    );
  }

  return (
    <form ref={formRef} noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      {!online ? <OfflineNotice /> : null}
      {serverError ? <FormAlert tone="error">{serverError}</FormAlert> : null}
      <PasswordField
        label={t("auth.newPassword")}
        name="new-password"
        autoComplete="new-password"
        required
        value={password}
        error={error}
        policy={{ min: policy.password.min, max: policy.password.max }}
        onChange={(e) => setPassword(e.target.value)}
      />
      <SubmitButton pending={pending} disabled={!online}>
        {t("auth.reset.submit")}
      </SubmitButton>
    </form>
  );
}
