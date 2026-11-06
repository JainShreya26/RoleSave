"use client";

import { useActionState } from "react";
import { requestPasswordReset, type AuthActionState } from "../actions";

const initialState: AuthActionState = {};

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, initialState);

  return (
    <form action={action} className="stack-form">
      <label htmlFor="email">
        Email
        <input autoComplete="email" id="email" name="email" required type="email" />
      </label>
      {state.errors?.email?.map((error) => <p className="field-error" key={error}>{error}</p>)}
      {state.message && (
        <p aria-live="polite" className={state.success ? "form-message success" : "form-message error"}>{state.message}</p>
      )}
      <button className="primary-button auth-submit" disabled={pending} type="submit">
        {pending ? "Sending…" : "Send reset link"}
      </button>
    </form>
  );
}
