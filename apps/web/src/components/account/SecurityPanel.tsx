"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { useRef, useState, type FormEvent } from "react";

import { ApiError } from "@/lib/api/client";
import { focusFirstInvalid, normalizeMfaCode } from "@/lib/forms";
import { useOnline } from "@/lib/hooks";

import { useAuth } from "../auth/AuthProvider";
import { OfflineNotice, useErrorText } from "../auth/shared";
import { Field } from "../forms/Field";
import { FormAlert } from "../forms/FormAlert";
import { PasswordField } from "../forms/PasswordField";
import { dangerButtonClass, secondaryButtonClass, SubmitButton } from "../forms/SubmitButton";
import { buttonClass } from "../StateMessage";

type Step = { kind: "idle" } | { kind: "setup"; secret: string; qr: string } | { kind: "codes"; codes: string[] };

export function SecurityPanel() {
  const t = useTranslations();
  const { user, client } = useAuth();
  const errorText = useErrorText();
  const online = useOnline();
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function start() {
    if (pending || !online) return;
    setPending(true);
    setNotice(null);
    try {
      const setup = await client.mfaSetup();
      const { toDataURL } = await import("qrcode");
      const qr = await toDataURL(setup.otpauthUri, { errorCorrectionLevel: "M", margin: 2, width: 240 });
      setStep({ kind: "setup", secret: setup.secret, qr });
    } catch (err) {
      setNotice({ tone: "error", text: errorText(err) });
    } finally {
      setPending(false);
    }
  }

  if (!user) return null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <h1 className="font-display text-3xl font-bold">{t("account.securityPage.title")}</h1>
      {!online ? <OfflineNotice /> : null}
      {notice ? <FormAlert tone={notice.tone}>{notice.text}</FormAlert> : null}
      <section aria-labelledby="mfa-section" className="flex flex-col gap-4 rounded-[20px] border border-white/10 bg-surface p-5 sm:p-6">
        <h2 id="mfa-section" className="font-display text-xl font-bold">
          {t("account.securityPage.mfaTitle")}
        </h2>
        <p className="text-text-muted">{t("account.securityPage.mfaLead")}</p>
        {step.kind === "codes" ? (
          <RecoveryCodes
            codes={step.codes}
            onDone={() => {
              setStep({ kind: "idle" });
              setNotice({ tone: "success", text: t("account.securityPage.enabled") });
            }}
          />
        ) : step.kind === "setup" ? (
          <EnableMfa
            secret={step.secret}
            qr={step.qr}
            onEnabled={(codes) => setStep({ kind: "codes", codes })}
            onCancel={() => setStep({ kind: "idle" })}
          />
        ) : user.mfaEnabled ? (
          <>
            <FormAlert tone="success" focus={false}>
              {t("account.securityPage.enabled")}
            </FormAlert>
            <DisableMfa onDisabled={() => setNotice({ tone: "success", text: t("account.securityPage.disabled") })} />
          </>
        ) : (
          <button type="button" className={`${buttonClass} self-start`} aria-disabled={pending || !online} onClick={start}>
            {t("account.securityPage.start")}
          </button>
        )}
      </section>
    </div>
  );
}

function EnableMfa({ secret, qr, onEnabled, onCancel }: { secret: string; qr: string; onEnabled: (codes: string[]) => void; onCancel: () => void }) {
  const t = useTranslations();
  const { client } = useAuth();
  const errorText = useErrorText();
  const formRef = useRef<HTMLFormElement>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setServerError(null);
    const normalized = normalizeMfaCode(code, "totp");
    if (!normalized) {
      setError(code.trim() ? t("errors.INVALID_MFA_CODE") : t("forms.required"));
      requestAnimationFrame(() => focusFirstInvalid(formRef.current));
      return;
    }
    setError(null);
    setPending(true);
    try {
      const { recoveryCodes } = await client.mfaEnable(normalized);
      await client.me().catch(() => undefined);
      onEnabled(recoveryCodes);
    } catch (err) {
      if (err instanceof ApiError && err.code === "INVALID_MFA_CODE") {
        setError(errorText(err));
        requestAnimationFrame(() => focusFirstInvalid(formRef.current));
      } else setServerError(errorText(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <form ref={formRef} noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      <p>{t("account.securityPage.scan")}</p>
      <Image
        src={qr}
        unoptimized
        alt={t("account.securityPage.qrAlt")}
        width={240}
        height={240}
        className="size-60 self-center rounded-xl bg-light-bg object-contain p-2"
      />
      <div className="flex flex-col gap-1">
        <p className="font-semibold">{t("account.securityPage.secret")}</p>
        <code className="tabular break-all rounded-lg bg-bg-deep p-2 text-sm tracking-wider">{secret.match(/.{1,4}/g)?.join(" ")}</code>
      </div>
      {serverError ? <FormAlert tone="error">{serverError}</FormAlert> : null}
      <Field
        label={t("auth.mfa.code")}
        name="one-time-code"
        autoComplete="one-time-code"
        inputMode="numeric"
        maxLength={7}
        required
        value={code}
        error={error}
        className="tabular tracking-widest"
        onChange={(e) => setCode(e.target.value)}
      />
      <SubmitButton pending={pending}>{t("account.securityPage.confirm")}</SubmitButton>
      <button type="button" className={secondaryButtonClass} onClick={onCancel}>
        {t("auth.mfa.back")}
      </button>
    </form>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const t = useTranslations("account.securityPage");
  const [copied, setCopied] = useState(false);
  const text = codes.join("\n");
  const href = `data:text/plain;charset=utf-8,${encodeURIComponent(`AntiSismo\n\n${text}\n`)}`;
  return (
    <div className="flex flex-col gap-4">
      <FormAlert tone="info" focus>
        <p className="font-semibold">{t("codesTitle")}</p>
        <p>{t("codesLead")}</p>
      </FormAlert>
      <ol className="tabular grid grid-cols-1 gap-2 rounded-xl bg-bg-deep p-4 font-mono min-[400px]:grid-cols-2">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className={secondaryButtonClass}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? t("copied") : t("copy")}
        </button>
        <a href={href} download="antisismo-codigos-recuperacion.txt" className={secondaryButtonClass}>
          {t("download")}
        </a>
        <button type="button" className={buttonClass} onClick={onDone}>
          {t("codesSaved")}
        </button>
      </div>
      <span aria-live="polite" className="sr-only">
        {copied ? t("copied") : ""}
      </span>
    </div>
  );
}

function DisableMfa({ onDisabled }: { onDisabled: () => void }) {
  const t = useTranslations();
  const { client } = useAuth();
  const errorText = useErrorText();
  const formRef = useRef<HTMLFormElement>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [errors, setErrors] = useState<Partial<Record<"password" | "code", string>>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setServerError(null);
    const normalized = normalizeMfaCode(code, "totp") ?? normalizeMfaCode(code, "recovery");
    const found: typeof errors = {};
    if (!password) found.password = t("forms.required");
    if (!normalized) found.code = code.trim() ? t("errors.INVALID_MFA_CODE") : t("forms.required");
    setErrors(found);
    if (Object.keys(found).length > 0 || !normalized) {
      requestAnimationFrame(() => focusFirstInvalid(formRef.current));
      return;
    }
    setPending(true);
    try {
      await client.mfaDisable(password, normalized);
      setPassword("");
      setCode("");
      await client.me().catch(() => undefined);
      onDisabled();
    } catch (err) {
      setServerError(errorText(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <details className="rounded-xl border border-white/10 p-4">
      <summary className="min-h-11 cursor-pointer content-center font-semibold">{t("account.securityPage.disableTitle")}</summary>
      <form ref={formRef} noValidate onSubmit={onSubmit} className="mt-3 flex flex-col gap-4">
        {serverError ? <FormAlert tone="error">{serverError}</FormAlert> : null}
        <PasswordField
          label={t("auth.password")}
          name="current-password"
          autoComplete="current-password"
          required
          value={password}
          error={errors.password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Field
          label={t("auth.mfa.code")}
          name="one-time-code"
          autoComplete="one-time-code"
          maxLength={24}
          required
          value={code}
          error={errors.code}
          onChange={(e) => setCode(e.target.value)}
        />
        <button type="submit" className={dangerButtonClass} aria-disabled={pending}>
          {pending ? t("forms.submitting") : t("account.securityPage.disableSubmit")}
        </button>
      </form>
    </details>
  );
}
