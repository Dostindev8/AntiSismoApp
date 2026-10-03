"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { Icon } from "../Icon";

const tones = {
  error: { cls: "border-alert-red-text/60 bg-alert-red-strong/15", icon: "alert", text: "text-alert-red-text" },
  success: { cls: "border-safe-green/60 bg-safe-green-strong/20", icon: "check", text: "text-text-primary" },
  info: { cls: "border-accent-cyan/50 bg-surface-high", icon: "info", text: "text-text-primary" },
} as const;

/** Mensaje de formulario; los errores reciben el foco para que el lector de pantalla los anuncie (WCAG 3.3.1/4.1.3). */
export function FormAlert({ tone, children, focus = tone === "error" }: { tone: keyof typeof tones; children: ReactNode; focus?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus) ref.current?.focus();
  }, [focus, children]);
  const t = tones[tone];
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role={tone === "error" ? "alert" : "status"}
      className={`flex items-start gap-2 rounded-xl border p-3 outline-none ${t.cls}`}
    >
      <Icon name={t.icon} className={`mt-0.5 size-5 shrink-0 ${t.text}`} />
      <div className={t.text}>{children}</div>
    </div>
  );
}
