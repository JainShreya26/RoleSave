"use client";

import { selectableApplicationStatuses } from "@rolesave/types";
import { useActionState, useState } from "react";
import { createApplicationAction, type ApplicationActionState } from "./actions";
import { titleCase } from "@/lib/format";

const initialState: ApplicationActionState = {};

export function ApplicationCreateForm() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createApplicationAction, initialState);

  if (!open) {
    return <button className="primary-button" onClick={() => setOpen(true)}><span aria-hidden="true">+</span> Add application</button>;
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-labelledby="new-application-title" aria-modal="true" className="modal" role="dialog">
        <div className="modal-heading">
          <div><p className="eyebrow">New application</p><h2 id="new-application-title">Add a role</h2></div>
          <button aria-label="Close" className="icon-button" onClick={() => setOpen(false)} type="button">×</button>
        </div>
        <form action={action} className="stack-form application-form">
          <div className="form-grid">
            <label>Company<input autoFocus name="company" required /></label>
            <label>Position<input name="position" required /></label>
            <label>Status<select defaultValue="APPLIED" name="status">{selectableApplicationStatuses.map((status) => <option key={status} value={status}>{titleCase(status)}</option>)}</select></label>
            <label>Applied at<input name="appliedAt" type="datetime-local" /></label>
            <label className="wide">Original URL<input name="originalUrl" placeholder="https://…" type="url" /></label>
            <label className="wide">Job or requisition ID<input name="jobId" /></label>
          </div>
          {state.errors && <p className="form-message error">Check the highlighted application details and try again.</p>}
          {state.message && <p className="form-message error">{state.message}</p>}
          <div className="form-actions">
            <button className="secondary-button" onClick={() => setOpen(false)} type="button">Cancel</button>
            <button className="primary-button" disabled={pending} type="submit">{pending ? "Creating…" : "Create application"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
