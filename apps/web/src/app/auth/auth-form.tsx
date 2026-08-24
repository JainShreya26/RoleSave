"use client";

import { useActionState, useState } from "react";
import { authenticate, type AuthActionState } from "./actions";

const initialState: AuthActionState = {};

export function AuthForm() {
  const [intent, setIntent] = useState<"sign-in" | "sign-up">("sign-in");
  const [state, action, pending] = useActionState(authenticate, initialState);

  return (
    <div className="auth-card">
      <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
        <button
          aria-selected={intent === "sign-in"}
          className={intent === "sign-in" ? "active" : ""}
          onClick={() => setIntent("sign-in")}
          role="tab"
          type="button"
        >
          Sign in
        </button>
        <button
          aria-selected={intent === "sign-up"}
          className={intent === "sign-up" ? "active" : ""}
          onClick={() => setIntent("sign-up")}
          role="tab"
          type="button"
        >
          Create account
        </button>
      </div>

      <form action={action} className="stack-form">
        <input name="intent" type="hidden" value={intent} />
        <label htmlFor="email">
          Email
          <input autoComplete="email" id="email" name="email" required type="email" />
        </label>
        {state.errors?.email?.map((error) => <p className="field-error" key={error}>{error}</p>)}

        <label htmlFor="password">
          Password
          <input
            autoComplete={intent === "sign-up" ? "new-password" : "current-password"}
            id="password"
            minLength={8}
            name="password"
            required
            type="password"
          />
        </label>
        {state.errors?.password?.map((error) => <p className="field-error" key={error}>{error}</p>)}

        {state.message && (
          <p aria-live="polite" className={state.success ? "form-message success" : "form-message error"}>
            {state.message}
          </p>
        )}

        <button className="primary-button auth-submit" disabled={pending} type="submit">
          {pending ? "Working…" : intent === "sign-up" ? "Create account" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
