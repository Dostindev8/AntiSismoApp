"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { buttonClass } from "../StateMessage";

export function SubmitButton({ pending, disabled, children }: { pending: boolean; disabled?: boolean; children: ReactNode }) {
  const t = useTranslations("forms");
  return (
    <button type="submit" aria-disabled={pending || disabled} disabled={disabled} className={`${buttonClass} w-full disabled:opacity-60`}>
      {pending ? t("submitting") : children}
    </button>
  );
}

export const secondaryButtonClass =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-white/25 px-5 font-semibold text-text-primary hover:bg-white/10";

export const dangerButtonClass =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-alert-red-text/60 px-5 font-semibold text-alert-red-text hover:bg-alert-red-strong/20";

export const linkClass = "font-semibold text-accent-cyan underline-offset-4 hover:underline";
