"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Link } from "@/i18n/navigation";
import { ApiError } from "@/lib/api/client";
import { tokenFromHash } from "@/lib/auth/helpers";
import { useFragmentOnce } from "@/lib/hooks";

import { FormAlert } from "../forms/FormAlert";
import { secondaryButtonClass } from "../forms/SubmitButton";
import { buttonClass } from "../StateMessage";
import { useAuth } from "./AuthProvider";
import { EmailRequestForm } from "./EmailRequestForm";
import { AuthCard, useErrorText } from "./shared";

type Result = { kind: "success" | "invalid" } | { kind: "error"; message: string };

export function VerifyEmail() {
  const t = useTranslations();
  const { client } = useAuth();
  const errorText = useErrorText();
  const fragment = useFragmentOnce();
  const token = fragment === null ? undefined : tokenFromHash(fragment);
  const [outcome, setOutcome] = useState<{ key: string; result: Result } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const started = useRef<string | null>(null);
  const key = token ? `${token}:${attempt}` : null;

  useEffect(() => {
    if (!token || !key || started.current === key) return;
    started.current = key;
    client.verifyEmail(token).then(
      () => setOutcome({ key, result: { kind: "success" } }),
      (err: unknown) =>
        setOutcome({
          key,
          result: err instanceof ApiError && err.code === "INVALID_TOKEN" ? { kind: "invalid" } : { kind: "error", message: errorText(err) },
        }),
    );
  }, [client, token, key, errorText]);

  const result = outcome?.key === key ? outcome.result : null;
  const status = token === undefined ? "verifying" : token === null ? "invalid" : (result?.kind ?? "verifying");

  return (
    <AuthCard title={t("auth.verify.title")}>
      {status === "verifying" ? (
        <p role="status" className="text-text-muted">
          {t("auth.verify.verifying")}
        </p>
      ) : null}
      {status === "success" ? (
        <>
          <FormAlert tone="success" focus>
            <p className="font-semibold">{t("auth.verify.successTitle")}</p>
            <p>{t("auth.verify.successBody")}</p>
          </FormAlert>
          <Link href="/auth/login" className={buttonClass}>
            {t("auth.login.title")}
          </Link>
        </>
      ) : null}
      {result?.kind === "error" ? (
        <>
          <FormAlert tone="error">{result.message}</FormAlert>
          <button
            type="button"
            className={secondaryButtonClass}
            onClick={() => setAttempt((a) => a + 1)}
          >
            {t("states.retry")}
          </button>
        </>
      ) : null}
      {status === "invalid" ? (
        <>
          <FormAlert tone="error">
            <p className="font-semibold">{t("auth.verify.invalidTitle")}</p>
            <p>{t("auth.verify.invalidBody")}</p>
          </FormAlert>
          <h2 className="font-display text-lg font-bold">{t("auth.verify.resendTitle")}</h2>
          <EmailRequestForm
            submitLabel={t("auth.verify.resendSubmit")}
            send={(email) => client.resendVerification(email)}
            done={() => t("auth.verify.resendDone")}
          />
        </>
      ) : null}
    </AuthCard>
  );
}
