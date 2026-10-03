"use client";

import { useTranslations } from "next-intl";
import { useRef, useState, type FormEvent, type ReactNode } from "react";

import { focusFirstInvalid, isEmail, normalizeEmail } from "@/lib/forms";
import { useOnline } from "@/lib/hooks";

import { Field } from "../forms/Field";
import { FormAlert } from "../forms/FormAlert";
import { SubmitButton } from "../forms/SubmitButton";
import { OfflineNotice, useErrorText } from "./shared";

/**
 * Formulario de un solo correo (recuperar contraseña, reenviar verificación). La respuesta es idéntica
 * exista o no la cuenta (anti-enumeración), así que el mensaje de éxito tampoco lo revela.
 */
export function EmailRequestForm({
  submitLabel,
  send,
  done,
}: {
  submitLabel: string;
  send: (email: string) => Promise<unknown>;
  done: (email: string) => ReactNode;
}) {
  const t = useTranslations();
  const online = useOnline();
  const errorText = useErrorText();
  const formRef = useRef<HTMLFormElement>(null);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setServerError(null);
    const mail = normalizeEmail(email);
    const problem = !mail ? t("forms.required") : !isEmail(mail) ? t("forms.invalidEmail") : null;
    setError(problem);
    if (problem) {
      requestAnimationFrame(() => focusFirstInvalid(formRef.current));
      return;
    }
    if (!online) return;
    setPending(true);
    try {
      await send(mail);
      setSentTo(mail);
    } catch (err) {
      setServerError(errorText(err));
    } finally {
      setPending(false);
    }
  }

  if (sentTo) return <FormAlert tone="success" focus>{done(sentTo)}</FormAlert>;

  return (
    <form ref={formRef} noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      {!online ? <OfflineNotice /> : null}
      {serverError ? <FormAlert tone="error">{serverError}</FormAlert> : null}
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
        error={error}
        onChange={(e) => setEmail(e.target.value)}
      />
      <SubmitButton pending={pending} disabled={!online}>
        {submitLabel}
      </SubmitButton>
    </form>
  );
}
