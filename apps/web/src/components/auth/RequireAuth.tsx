"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState, type ReactNode } from "react";

import { Link, usePathname, useRouter } from "@/i18n/navigation";

import { FormAlert } from "../forms/FormAlert";
import { linkClass } from "../forms/SubmitButton";
import { useAuth } from "./AuthProvider";

/**
 * Guarda de rutas privadas. Si la sesión expira con la pantalla abierta NO desmonta el contenido
 * (lo escrito no se pierde): muestra un aviso con enlace para volver a entrar en otra pestaña.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const t = useTranslations("auth.guard");
  const { status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [seenSession, setSeenSession] = useState(false);
  if (status === "authenticated" && !seenSession) setSeenSession(true);

  useEffect(() => {
    if (status === "anonymous" && !seenSession) {
      router.replace({ pathname: "/auth/login", query: { next: pathname } });
    }
  }, [status, seenSession, router, pathname]);

  if (status === "authenticated") return <>{children}</>;
  if (status === "anonymous" && seenSession) {
    return (
      <div className="flex flex-col gap-4">
        <FormAlert tone="error">
          <p className="font-semibold">{t("expiredTitle")}</p>
          <p>{t("expiredBody")}</p>
          <Link href={{ pathname: "/auth/login", query: { next: pathname } }} target="_blank" rel="noopener" className={linkClass}>
            {t("signInAgain")}
          </Link>
        </FormAlert>
        <div inert>{children}</div>
      </div>
    );
  }
  return (
    <p role="status" className="text-text-muted">
      {t("checking")}
    </p>
  );
}
