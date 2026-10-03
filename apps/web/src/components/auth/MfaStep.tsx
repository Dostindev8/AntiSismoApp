"use client";

import { useTranslations } from "next-intl";
import { useRef, useState, type FormEvent } from "react";

import { ApiError } from "@/lib/api/client";
import { focusFirstInvalid, normalizeMfaCode } from "@/lib/forms";
import { useOnline } from "@/lib/hooks";

import { Field } from "../forms/Field";
import { FormAlert } from "../forms/FormAlert";
import { linkClass, secondaryButtonClass, SubmitButton } from "../forms/SubmitButton";
import { useAuth } from "./AuthProvider";
import { OfflineNotice, useErrorText } from "./shared";

/** Segundo factor tras contraseña u OAuth: TOTP o código de recuperación de un solo uso. */
export function MfaStep({ mfaToken, onDone, onCancel }: { mfaToken: string; onDone: () => void; onCancel: () => void }) {
  const t = useTranslations();
  const { client } = useAuth();
  const online = useOnline();
  const errorText = useErrorText();
  const formRef = useRef<HTMLFormElement>(null);
  const [mode, setMode] = useState<"totp" | "recovery">("totp");
  const [code, setCode] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending || !online) return;
    setServerError(null);
    const normalized = normalizeMfaCode(code, mode);
    if (!normalized) {
      setFieldError(code.trim() ? t("errors.INVALID_MFA_CODE") : t("forms.required"));
      requestAnimationFrame(() => focusFirstInvalid(formRef.current));
      return;
    }
    setFieldError(null);
    setPending(true);
    try {
      await client.loginMfa(mfaToken, normalized);
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.code === "INVALID_TOKEN") setServerError(t("auth.mfa.expired"));
      else if (err instanceof ApiError && err.code === "INVALID_MFA_CODE") {
        setFieldError(errorText(err));
        setCode("");
        requestAnimationFrame(() => focusFirstInvalid(formRef.current));
      } else setServerError(errorText(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <form ref={formRef} noValidate onSubmit={onSubmit} className="flex flex-col gap-4" aria-labelledby="mfa-title">
      <h2 id="mfa-title" className="font-display text-xl font-bold">
        {t("auth.mfa.title")}
      </h2>
      <p className="text-text-muted">{t("auth.mfa.lead")}</p>
      {!online ? <OfflineNotice /> : null}
      {serverError ? <FormAlert tone="error">{serverError}</FormAlert> : null}
      <Field
        key={mode}
        label={mode === "totp" ? t("auth.mfa.code") : t("auth.mfa.recoveryCode")}
        name="one-time-code"
        autoComplete="one-time-code"
        inputMode={mode === "totp" ? "numeric" : "text"}
        autoCapitalize={mode === "totp" ? "none" : "characters"}
        spellCheck={false}
        maxLength={mode === "totp" ? 7 : 24}
        required
        autoFocus
        value={code}
        error={fieldError}
        className="tabular tracking-widest"
        onChange={(e) => setCode(e.target.value)}
      />
      <SubmitButton pending={pending} disabled={!online}>
        {t("auth.mfa.submit")}
      </SubmitButton>
      <button
        type="button"
        className={`${linkClass} min-h-11 self-center`}
        onClick={() => {
          setMode((m) => (m === "totp" ? "recovery" : "totp"));
          setCode("");
          setFieldError(null);
        }}
      >
        {mode === "totp" ? t("auth.mfa.useRecovery") : t("auth.mfa.useTotp")}
      </button>
      <button type="button" className={secondaryButtonClass} onClick={onCancel}>
        {t("auth.mfa.back")}
      </button>
    </form>
  );
}
