"use client";

import { startTransition, useId, useState, useSyncExternalStore, type FormEvent, type InputHTMLAttributes } from "react";
import { fromDateTimeLocal, toDateTimeLocal } from "@/lib/format";
import { subscribeToNothing } from "./local-date";

type FieldErrors = Record<string, string[]> | undefined;

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "defaultValue" | "name" | "value"> {
  errors: FieldErrors;
  label: string;
  name: string;
  wide?: boolean;
}

/**
 * Submits a form without losing what was typed. React clears a form once its
 * action finishes, even when the server refused the values. Running the action
 * here skips that.
 */
export function submitKeepingValues(action: (data: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => action(data));
  };
}

function useFieldError(errors: FieldErrors, name: string) {
  const id = useId();
  const message = errors?.[name]?.[0];
  return {
    inputProps: message ? { "aria-describedby": id, "aria-invalid": true } : {},
    node: message ? <span className="field-error" id={id}>{message}</span> : null,
  };
}

/** A text field that shows its own error. */
export function TextField({ defaultValue = "", errors, label, name, wide = false, ...input }: FieldProps & { defaultValue?: string }) {
  const error = useFieldError(errors, name);
  return (
    <label className={wide ? "wide" : undefined}>
      {label}
      <input {...input} {...error.inputProps} defaultValue={defaultValue} name={name} />
      {error.node}
    </label>
  );
}

/**
 * A date and time field that works in the viewer's time zone. The server does
 * not know that zone, so the form submits the exact moment instead of the text
 * that was typed.
 */
export function DateTimeField({ defaultValue = null, errors, label, name, wide = false, ...input }: FieldProps & { defaultValue?: string | null }) {
  const isBrowser = useSyncExternalStore(subscribeToNothing, () => true, () => false);
  const [typed, setTyped] = useState<string | null>(null);
  const error = useFieldError(errors, name);
  const shown = typed ?? (isBrowser ? toDateTimeLocal(defaultValue) : "");
  return (
    <label className={wide ? "wide" : undefined}>
      {label}
      <input {...input} {...error.inputProps} onChange={(event) => setTyped(event.target.value)} type="datetime-local" value={shown} />
      <input name={name} type="hidden" value={typed === null ? (defaultValue ?? "") : fromDateTimeLocal(typed)} />
      {error.node}
    </label>
  );
}
