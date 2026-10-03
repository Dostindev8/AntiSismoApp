"use client";

import { useTranslations } from "next-intl";
import { useState, type InputHTMLAttributes } from "react";

import { passwordStrength, type Strength } from "@/lib/auth/helpers";

import { Icon } from "../Icon";
import { Field } from "./Field";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "id"> & {
  label: string;
  error?: string | null;
  /** Con política: muestra medidor de fuerza y pistas (registro y restablecimiento). */
  policy?: { min: number; max: number; email?: string };
  value: string;
};

const barColor: Record<Strength["level"], string> = {
  0: "bg-alert-red",
  1: "bg-alert-red",
  2: "bg-warn-amber",
  3: "bg-safe-green",
  4: "bg-safe-green",
};

export function PasswordField({ label, error, policy, value, ...input }: Props) {
  const t = useTranslations();
  const [visible, setVisible] = useState(false);
  const strength = policy ? passwordStrength(value, policy) : null;

  const toggle = (
    <button
      type="button"
      onClick={() => setVisible((v) => !v)}
      aria-pressed={visible}
      aria-label={visible ? t("forms.hidePassword") : t("forms.showPassword")}
      className="inline-flex size-11 items-center justify-center rounded-lg text-text-muted hover:text-text-primary"
    >
      <Icon name={visible ? "eyeOff" : "eye"} className="size-5" />
    </button>
  );

  const hint =
    policy && strength ? (
      <div className="flex flex-col gap-1.5">
        <div className="flex gap-1" aria-hidden="true">
          {[1, 2, 3, 4].map((i) => (
            <span key={i} className={`h-1.5 flex-1 rounded-full ${value && strength.level >= i ? barColor[strength.level] : "bg-white/15"}`} />
          ))}
        </div>
        {value ? (
          <p aria-live="polite">{t("auth.strength.label", { level: t(`auth.strength.level${strength.level}`) })}</p>
        ) : (
          <p>{t("auth.strength.hint", { min: policy.min })}</p>
        )}
        {value && strength.issues.length > 0 ? (
          <ul className="list-disc pl-5">
            {strength.issues.map((issue) => (
              <li key={issue}>{t(`auth.strength.${issue}`, { min: policy.min, max: policy.max })}</li>
            ))}
          </ul>
        ) : null}
        <p>{t("auth.strength.breachNote")}</p>
      </div>
    ) : undefined;

  return (
    <Field
      {...input}
      label={label}
      type={visible ? "text" : "password"}
      value={value}
      error={error}
      hint={hint}
      trailing={toggle}
      spellCheck={false}
      autoCapitalize="none"
      maxLength={policy?.max ?? 1024}
    />
  );
}
