"use client";

import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";

import { linkClass } from "../forms/SubmitButton";
import { useAuth } from "./AuthProvider";
import { EmailRequestForm } from "./EmailRequestForm";
import { AuthCard } from "./shared";

export function ForgotForm() {
  const t = useTranslations("auth");
  const { client } = useAuth();
  return (
    <AuthCard title={t("forgot.title")} lead={t("forgot.lead")}>
      <EmailRequestForm
        submitLabel={t("forgot.submit")}
        send={(email) => client.forgotPassword(email)}
        done={(email) => (
          <>
            <p className="font-semibold">{t("forgot.doneTitle")}</p>
            <p>{t("forgot.doneBody", { email })}</p>
          </>
        )}
      />
      <Link href="/auth/login" className={`${linkClass} self-center py-2`}>
        {t("login.title")}
      </Link>
    </AuthCard>
  );
}
