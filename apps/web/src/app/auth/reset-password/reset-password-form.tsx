"use client";

import { useActionState } from "react";
import { updatePassword, type AuthActionState } from "../actions";

const initialState: AuthActionState = {};

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState(updatePassword, initialState);

  return (
    <form action={action} className="stack-form">
      <label htmlFor="password">
        New password
        <input autoComplete="new-password" id="password" minLength={8} name="password" required type="password" />
      </label>
      {state.errors?.password?.map((error) => <p className="field-error" key={error}>{error}</p>)}
      <label htmlFor="confirmPassword">
        Confirm new password
        <input autoComplete="new-password" id="confirmPassword" minLength={8} name="confirmPassword" required type="password" />
      </label>
      {state.errors?.confirmPassword?.map((error) => <p className="field-error" key={error}>{error}</p>)}
      {state.message && <p aria-live="polite" className="form-message error">{state.message}</p>}
      <button className="primary-button auth-submit" disabled={pending} type="submit">
        {pending ? "Saving…" : "Update password"}
      </button>
    </form>
  );
}
