"use client";

import { selectableApplicationStatuses } from "@rolesave/types";
import { useActionState, useState } from "react";
import { createApplicationAction, type ApplicationActionState } from "./actions";
import { DateTimeField, submitKeepingValues, TextField } from "./application-fields";
import { titleCase } from "@/lib/format";

const initialState: ApplicationActionState = {};

// Mounted only while open, so reopening starts with an empty form and no old errors.
function CreateDialog({ onClose }: { onClose: () => void }) {
  const [state, action, pending] = useActionState(createApplicationAction, initialState);

  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-labelledby="new-application-title" aria-modal="true" className="modal" role="dialog">
        <div className="modal-heading">
          <div><p className="eyebrow">New application</p><h2 id="new-application-title">Add a role</h2></div>
          <button aria-label="Close" className="icon-button" onClick={onClose} type="button">×</button>
        </div>
        <form action={action} className="stack-form application-form" onSubmit={submitKeepingValues(action)}>
          <div className="form-grid">
            <TextField autoFocus errors={state.errors} label="Company" maxLength={200} name="company" required />
            <TextField errors={state.errors} label="Position" maxLength={300} name="position" required />
            <label>Status<select defaultValue="APPLIED" name="status">{selectableApplicationStatuses.map((item) => <option key={item} value={item}>{titleCase(item)}</option>)}</select></label>
            <DateTimeField errors={state.errors} label="Applied at" name="appliedAt" />
            <TextField errors={state.errors} label="Original URL" name="originalUrl" placeholder="https://…" type="url" wide />
            <TextField errors={state.errors} label="Job or requisition ID" maxLength={200} name="jobId" wide />
          </div>
          {state.errors && <p className="form-message error">Fix the highlighted fields and try again.</p>}
          {state.message && <p className="form-message error">{state.message}</p>}
          <div className="form-actions">
            <button className="secondary-button" onClick={onClose} type="button">Cancel</button>
            <button className="primary-button" disabled={pending} type="submit">{pending ? "Creating…" : "Create application"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function ApplicationCreateForm() {
  const [open, setOpen] = useState(false);
  if (!open) {
    return <button className="primary-button" onClick={() => setOpen(true)}><span aria-hidden="true">+</span> Add application</button>;
  }
  return <CreateDialog onClose={() => setOpen(false)} />;
}
