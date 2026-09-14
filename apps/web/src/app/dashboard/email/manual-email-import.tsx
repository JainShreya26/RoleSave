"use client";

import { useActionState } from "react";
import { importEmailAction, type EmailConnectionActionState } from "./actions";

const initialState: EmailConnectionActionState = {};

export function ManualEmailImport() {
  const [state, action, pending] = useActionState(importEmailAction, initialState);

  return (
    <section className="panel manual-email-import">
      <div className="panel-heading">
        <div>
          <h2>Import a missed email</h2>
          <p>Paste any recruiting email that Gmail did not forward. It uses the same classifier and matching pipeline.</p>
        </div>
      </div>
      <form action={action} className="stack-form manual-email-form">
        <div className="form-grid">
          <label>Sender email
            <input autoComplete="off" name="senderAddress" placeholder="recruiting@example.com" required type="email" />
          </label>
          <label>Sender name <span className="optional-label">Optional</span>
            <input autoComplete="off" maxLength={200} name="senderName" placeholder="Example Recruiting" />
          </label>
          <label className="wide">Subject
            <input maxLength={500} name="subject" placeholder="Thank you for applying…" required />
          </label>
          <label className="wide">Email text
            <textarea maxLength={100000} name="body" placeholder="Paste the email body here" required rows={8} />
          </label>
        </div>
        <div className="form-actions">
          <button className="primary-button" disabled={pending} type="submit">
            {pending ? "Importing…" : "Import email"}
          </button>
        </div>
        {state.message && (
          <p aria-live="polite" className={`form-message ${state.success ? "success" : "error"}`}>
            {state.message}
          </p>
        )}
      </form>
    </section>
  );
}
