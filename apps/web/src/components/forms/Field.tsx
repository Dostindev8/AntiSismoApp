"use client";

import { useId, type InputHTMLAttributes, type ReactNode } from "react";

export const inputClass =
  "min-h-11 w-full rounded-xl border border-white/20 bg-bg-deep px-3 py-2 text-base text-text-primary placeholder:text-text-muted aria-[invalid=true]:border-alert-red-text";

type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "aria-describedby" | "aria-invalid"> & {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  optionalLabel?: string;
  trailing?: ReactNode;
  footer?: ReactNode;
};

/** Campo accesible: etiqueta visible, pista y error enlazados con aria-describedby; aria-invalid solo cuando hay error. */
export function Field({ label, hint, error, optionalLabel, trailing, footer, className, ...input }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-semibold">
        {label}
        {optionalLabel ? <span className="ml-1 font-normal text-text-muted">{optionalLabel}</span> : null}
      </label>
      <div className="relative flex items-center">
        <input
          id={id}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={`${inputClass} ${trailing ? "pr-14" : ""} ${className ?? ""}`}
          {...input}
        />
        {trailing ? <div className="absolute right-1">{trailing}</div> : null}
      </div>
      {error ? (
        <p id={errorId} className="text-sm font-medium text-alert-red-text">
          {error}
        </p>
      ) : null}
      {hint ? (
        <div id={hintId} className="text-sm text-text-muted">
          {hint}
        </div>
      ) : null}
      {footer}
    </div>
  );
}
