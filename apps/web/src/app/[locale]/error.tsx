"use client";

import { useTranslations } from "next-intl";

import { buttonClass, StateMessage } from "@/components/StateMessage";

export default function ErrorBoundary({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("states");
  return (
    <StateMessage
      icon="alert"
      title={t("errorTitle")}
      body={t("errorBody")}
      action={
        <button type="button" onClick={reset} className={buttonClass}>
          {t("retry")}
        </button>
      }
    />
  );
}
