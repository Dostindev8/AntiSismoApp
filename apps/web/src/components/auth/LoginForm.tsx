"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { Link, useRouter } from "@/i18n/navigation";
import { API_BASE, ApiError } from "@/lib/api/client";
import { safeNextPath } from "@/lib/auth/helpers";
import { focusFirstInvalid, isEmail, normalizeEmail } from "@/lib/forms";
import { useHash, useOnline } from "@/lib/hooks";

import { Field } from "../forms/Field";
import { FormAlert } from "../forms/FormAlert";
import { PasswordField } from "../forms/PasswordField";
import { linkClass, secondaryButtonClass, SubmitButton } from "../forms/SubmitButton";
import { useAuth } from "./AuthProvider";
import { MfaStep } from "./MfaStep";
import { AuthCard, OfflineNotice, useErrorText } from "./shared";

type Errors = Partial<Record<"email" | "password", string>>;

/** Destino tras iniciar sesión: solo rutas internas (bloquea redirecciones abiertas). */
export function nextFromLocation(): string {
  return safeNextPath(new URLSearchParams(window.location.search).get("next"));
}

export function LoginForm() {
  const t = useTranslations();
  const router = useRouter();
  const { client, status } = useAuth();
  const online = useOnline();
  const errorText = useErrorText();
  const hash = useHash();
  const formRef = useRef<HTMLFormElement>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const [resent, setResent] = useState(false);
  const [pending, setPending] = useState(false);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [google, setGoogle] = useState(false);

  const oauthFailed = hash !== null && new URLSearchParams(hash.slice(1)).get("error") === "oauth";

  useEffect(() => {
    let alive = true;
    client.policy().then(
      (p) => alive && setGoogle(p.google),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [client]);

  useEffect(() => {
    if (status === "authenticated" && !mfaToken) router.replace(nextFromLocation());
  }, [status, mfaToken, router]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setServerError(null);
    setUnverified(false);
    const mail = normalizeEmail(email);
    const found: Errors = {};
    if (!mail) found.email = t("forms.required");
    else if (!isEmail(mail)) found.email = t("forms.invalidEmail");
    if (!password) found.password = t("forms.required");
    setErrors(found);
    if (Object.keys(found).length > 0) {
      requestAnimationFrame(() => focusFirstInvalid(formRef.current));
      return;
    }
    if (!online) return;
    setPending(true);
    try {
      const result = await client.login(mail, password);
      setPassword("");
      if ("mfaToken" in result) setMfaToken(result.mfaToken);
    } catch (err) {
      if (err instanceof ApiError && err.code === "EMAIL_NOT_VERIFIED") setUnverified(true);
      setServerError(errorText(err));
    } finally {
      setPending(false);
    }
  }

  async function resend() {
    setResent(false);
    try {
      await client.resendVerification(normalizeEmail(email));
      setResent(true);
    } catch (err) {
      setServerError(errorText(err));
    }
  }

  if (mfaToken) {
    return (
      <AuthCard title={t("auth.login.title")}>
        <MfaStep mfaToken={mfaToken} onDone={() => router.replace(nextFromLocation())} onCancel={() => setMfaToken(null)} />
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t("auth.login.title")}>
      <form ref={formRef} noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        {!online ? <OfflineNotice /> : null}
        {oauthFailed && !serverError ? <FormAlert tone="error">{t("auth.login.oauthError")}</FormAlert> : null}
        {serverError ? (
          <FormAlert tone="error">
            <p>{serverError}</p>
            {unverified ? (
              <button type="button" onClick={resend} className={`${linkClass} mt-1 min-h-11 text-left`}>
                {t("auth.login.resendLink")}
              </button>
            ) : null}
          </FormAlert>
        ) : null}
        {resent ? <FormAlert tone="success">{t("auth.verify.resendDone")}</FormAlert> : null}
        <Field
          label={t("auth.email")}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          maxLength={254}
          value={email}
          error={errors.email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <PasswordField
          label={t("auth.password")}
          name="current-password"
          autoComplete="current-password"
          required
          value={password}
          error={errors.password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Link href="/auth/forgot" className={`${linkClass} self-start py-2`}>
          {t("auth.login.forgot")}
        </Link>
        <SubmitButton pending={pending} disabled={!online}>
          {t("auth.login.submit")}
        </SubmitButton>
        <p className="text-sm text-text-muted">{t("auth.login.lockNote")}</p>
        {google ? (
          <>
            <p className="text-center text-text-muted" aria-hidden="true">
              {t("auth.login.or")}
            </p>
            <a href={`${API_BASE}/auth/google/start`} className={secondaryButtonClass}>
              {t("auth.login.google")}
            </a>
          </>
        ) : null}
        <p className="text-center text-text-muted">
          {t("auth.login.noAccount")}{" "}
          <Link href="/auth/register" className={linkClass}>
            {t("auth.login.createAccount")}
          </Link>
        </p>
      </form>
    </AuthCard>
  );
}
