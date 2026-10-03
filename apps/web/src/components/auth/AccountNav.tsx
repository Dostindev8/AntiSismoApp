"use client";

import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";

import { Icon } from "../Icon";
import { useAuth } from "./AuthProvider";

/** Entrada de cuenta en la cabecera; durante la carga reserva el espacio para no mover el diseño (CLS). */
export function AccountNav() {
  const t = useTranslations("nav");
  const { status } = useAuth();
  const authenticated = status === "authenticated";
  return (
    <Link
      href={authenticated ? "/account" : "/auth/login"}
      aria-label={authenticated ? t("account") : t("signIn")}
      className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full border border-white/20 px-3 font-semibold hover:bg-white/10"
    >
      <Icon name="user" className="size-5" />
      <span className="hidden sm:inline">{authenticated ? t("account") : t("signIn")}</span>
    </Link>
  );
}
