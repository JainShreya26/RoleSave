"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { authenticate, resendConfirmation, type AuthActionState } from "./actions";

const initialState: AuthActionState = {};

export function AuthForm({ linkError = false, next = "/dashboard" }: { linkError?: boolean; next?: string }) {
  const [intent, setIntent] = useState<"sign-in" | "sign-up">("sign-in");
  // Controlled so the email survives the form reset after a failed attempt.
  const [email, setEmail] = useState("");
  const [authResult, action, pending] = useActionState(authenticate, initialState);
  const [resendResult, resend, resending] = useActionState(resendConfirmation, initialState);
  const [lastAction, setLastAction] = useState<"auth" | "resend" | null>(null);
  // Results belong to the tab they came from, so switching tabs hides them.
  const state = lastAction === "auth" ? authResult : lastAction === "resend" ? resendResult : initialState;
  const showResend =
    intent === "sign-in" && (linkError || lastAction === "resend" || (lastAction === "auth" && authResult.needsConfirmation));

  function switchTo(tab: "sign-in" | "sign-up") {
    setIntent(tab);
    setLastAction(null);
  }

  return (
    <div className="auth-card">
      <div className="auth-card-brand">
        <span className="logo-mark" aria-hidden="true"><span /><span /><span /></span>
        <strong>RoleSave</strong>
      </div>
      <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
        <button
          aria-selected={intent === "sign-in"}
          className={intent === "sign-in" ? "active" : ""}
          onClick={() => switchTo("sign-in")}
          role="tab"
          type="button"
        >
          Sign in
        </button>
        <button
          aria-selected={intent === "sign-up"}
          className={intent === "sign-up" ? "active" : ""}
          onClick={() => switchTo("sign-up")}
          role="tab"
          type="button"
        >
          Create account
        </button>
      </div>

      <form
        action={action}
        className="stack-form"
        onSubmit={(event) => {
          const submitter = (event.nativeEvent as SubmitEvent).submitter;
          setLastAction(submitter?.dataset.action === "resend" ? "resend" : "auth");
        }}
      >
        <input name="intent" type="hidden" value={intent} />
        <input name="next" type="hidden" value={next} />
        {linkError && intent === "sign-in" && (
          <p className="form-message error" role="alert">That link is invalid or has expired. Use the options below to get a new one.</p>
        )}
        <label htmlFor="email">
          Email
          <input
            autoComplete="email"
            id="email"
            name="email"
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
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

        {intent === "sign-in" && (
          <p className="form-message"><Link href="/auth/forgot-password">Forgot your password?</Link></p>
        )}

        {state.message && (
          <p aria-live="polite" className={state.success ? "form-message success" : "form-message error"}>
            {state.message}
          </p>
        )}

        <button className="primary-button auth-submit" disabled={pending} type="submit">
          {pending ? "Working…" : intent === "sign-up" ? "Create account" : "Sign in"}
        </button>

        {showResend && (
          <button
            className="secondary-button"
            data-action="resend"
            disabled={resending}
            formAction={resend}
            formNoValidate
            type="submit"
          >
            {resending ? "Sending…" : "Resend confirmation email"}
          </button>
        )}
      </form>
    </div>
  );
}
