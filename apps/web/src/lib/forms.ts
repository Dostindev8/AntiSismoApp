/** Validación de forma (la autoridad es el servidor); mismo criterio práctico que zod `email()`. */
export function isEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value);
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** Código TOTP de 6 dígitos o código de recuperación `XXXX-XXXX-XXXX-XXXX` (base32, se aceptan minúsculas y espacios). */
export function normalizeMfaCode(value: string, mode: "totp" | "recovery"): string | null {
  if (mode === "totp") {
    const digits = value.replace(/\s+/g, "");
    return /^\d{6}$/.test(digits) ? digits : null;
  }
  const compact = value.toUpperCase().replace(/[\s-]+/g, "");
  if (!/^[A-Z2-7]{16}$/.test(compact)) return null;
  return compact.match(/.{4}/g)!.join("-");
}

/** Mueve el foco al primer campo inválido del formulario (WCAG 3.3.1). */
export function focusFirstInvalid(form: HTMLFormElement | null): void {
  const el = form?.querySelector<HTMLElement>("[aria-invalid='true']");
  el?.focus();
}
