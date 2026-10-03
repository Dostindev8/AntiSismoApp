"use client";

import type { AuthPolicy } from "@antisismo/proto/account";
import { useLocale, useTranslations } from "next-intl";
import { useRef, useState, type FormEvent } from "react";

import { Link } from "@/i18n/navigation";
import { ApiError } from "@/lib/api/client";
import { passwordStrength } from "@/lib/auth/helpers";
import { focusFirstInvalid, isEmail, normalizeEmail } from "@/lib/forms";
import { useOnline } from "@/lib/hooks";

import { Field } from "../forms/Field";
import { FormAlert } from "../forms/FormAlert";
import { PasswordField } from "../forms/PasswordField";
import { linkClass, SubmitButton } from "../forms/SubmitButton";
import { useAuth } from "./AuthProvider";
import { AuthCard, LegalLink, OfflineNotice, PolicyGate, useErrorText } from "./shared";

type Errors = Partial<Record<"email" | "password" | "terms", string>>;

export function RegisterForm() {
  const t = useTranslations("auth");
  return (
    <AuthCard title={t("register.title")} lead={t("register.lead")}>
      <PolicyGate>{(policy) => <RegisterFields policy={policy} />}</PolicyGate>
    </AuthCard>
  );
}

function RegisterFields({ policy }: { policy: AuthPolicy }) {
  const t = useTranslations();
  const locale = useLocale();
  const { client } = useAuth();
  const online = useOnline();
  const errorText = useErrorText();
  const formRef = useRef<HTMLFormElement>(null);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [terms, setTerms] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  function validate(): Errors {
    const next: Errors = {};
    const mail = normalizeEmail(email);
    if (!mail) next.email = t("forms.required");
    else if (!isEmail(mail)) next.email = t("forms.invalidEmail");
    const strength = passwordStrength(password, { min: policy.password.min, max: policy.password.max, email: mail });
    if (!password) next.password = t("forms.required");
    else if (!strength.meetsPolicy) next.password = t("errors.WEAK_PASSWORD");
    if (!terms) next.terms = t("auth.register.termsRequired");
    return next;
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setServerError(null);
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) {
      requestAnimationFrame(() => focusFirstInvalid(formRef.current));
      return;
    }
    if (!online) return;
    setPending(true);
    const mail = normalizeEmail(email);
    try {
      await client.register({
        email: mail,
        password,
        displayName: displayName.trim() || undefined,
        locale,
        termsVersion: policy.termsVersion,
      });
      setPassword("");
      setDone(mail);
    } catch (err) {
      if (err instanceof ApiError && (err.code === "WEAK_PASSWORD" || err.code === "BREACHED_PASSWORD")) {
        setErrors({ password: errorText(err) });
        requestAnimationFrame(() => focusFirstInvalid(formRef.current));
      } else if (err instanceof ApiError && err.code === "TERMS_OUTDATED") {
        setTerms(false);
        setServerError(t("auth.register.termsOutdated"));
      } else {
        setServerError(errorText(err));
      }
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <FormAlert tone="success" focus>
        <p className="font-semibold">{t("auth.register.doneTitle")}</p>
        <p>{t("auth.register.doneBody", { email: done })}</p>
      </FormAlert>
    );
  }

  return (
    <form ref={formRef} noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      {!online ? <OfflineNotice /> : null}
      {serverError ? <FormAlert tone="error">{serverError}</FormAlert> : null}
      <Field
        label={t("auth.displayName")}
        optionalLabel={t("forms.optional")}
        name="displayName"
        autoComplete="nickname"
        maxLength={80}
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
      />
      <Field
        label={t("auth.email")}
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
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
        name="new-password"
        autoComplete="new-password"
        required
        value={password}
        error={errors.password}
        policy={{ min: policy.password.min, max: policy.password.max, email: normalizeEmail(email) }}
        onChange={(e) => setPassword(e.target.value)}
      />
      <div className="flex flex-col gap-1.5">
        <div className="flex items-start gap-3">
          <input
            id="terms"
            type="checkbox"
            checked={terms}
            onChange={(e) => setTerms(e.target.checked)}
            aria-invalid={errors.terms ? true : undefined}
            aria-describedby={errors.terms ? "terms-error" : undefined}
            className="mt-0.5 size-6 shrink-0 accent-accent-blue"
          />
          <label htmlFor="terms">
            {t.rich("auth.register.termsLabel", {
              terms: (chunks) => <LegalLink href="/legal/terminos">{chunks}</LegalLink>,
              privacy: (chunks) => <LegalLink href="/legal/privacidad">{chunks}</LegalLink>,
            })}
          </label>
        </div>
        {errors.terms ? (
          <p id="terms-error" className="text-sm font-medium text-alert-red-text">
            {errors.terms}
          </p>
        ) : null}
      </div>
      <SubmitButton pending={pending} disabled={!online}>
        {t("auth.register.submit")}
      </SubmitButton>
      <p className="text-center text-text-muted">
        {t("auth.register.haveAccount")}{" "}
        <Link href="/auth/login" className={linkClass}>
          {t("auth.login.title")}
        </Link>
      </p>
    </form>
  );
}
