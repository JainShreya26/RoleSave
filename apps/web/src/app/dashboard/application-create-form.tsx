"use client";

import { selectableApplicationStatuses } from "@rolesave/types";
import { useActionState, useEffect, useState } from "react";
import { createApplicationAction, type ApplicationActionState } from "./actions";
import { DateTimeField, submitKeepingValues, TextField } from "./application-fields";
import { titleCase } from "@/lib/format";

const initialState: ApplicationActionState = {};

// Mounted only while open, so reopening starts with an empty form and no old errors.
function CreateDialog({ onClose }: { onClose: () => void }) {
  const [state, action, pending] = useActionState(createApplicationAction, initialState);
  const [status, setStatus] = useState("APPLIED");

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-labelledby="new-application-title" aria-modal="true" className="modal" role="dialog">
        <div className="modal-heading">
          <h2 id="new-application-title">Add a role</h2>
          <button aria-label="Close" className="icon-button" onClick={onClose} type="button">×</button>
        </div>
        <form action={action} className="stack-form application-form" onSubmit={submitKeepingValues(action)}>
          <div className="form-grid">
            <TextField autoFocus errors={state.errors} label="Company" maxLength={200} name="company" required />
            <TextField errors={state.errors} label="Position" maxLength={300} name="position" required />
            <label>Status<select name="status" onChange={(event) => setStatus(event.target.value)} value={status}>{selectableApplicationStatuses.map((item) => <option key={item} value={item}>{titleCase(item)}</option>)}</select></label>
            {/* A saved role has no applied date, so the field is only there once it can be filled in. */}
            {status === "SAVED"
              ? <p className="field-note">A saved role gets its applied date when you move it to Applied.</p>
              : <DateTimeField errors={state.errors} hint="Leave blank to use now." label="Date applied" name="appliedAt" />}
            <TextField errors={state.errors} label="Job posting link" name="originalUrl" optional placeholder="https://…" type="url" wide />
            <TextField errors={state.errors} label="Job or requisition ID" maxLength={200} name="jobId" optional wide />
          </div>
          {state.errors && <p className="form-message error">Fix the highlighted fields and try again.</p>}
          {state.message && <p className="form-message error">{state.message}</p>}
          <div className="form-actions">
            <button className="secondary-button" onClick={onClose} type="button">Cancel</button>
            <button className="primary-button" disabled={pending} type="submit">{pending ? "Adding…" : "Add role"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function ApplicationCreateForm() {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* The button stays where it is while the dialog is open, so the page behind does not move. */}
      <button className="primary-button" onClick={() => setOpen(true)} type="button"><span aria-hidden="true">+</span> Add role</button>
      {open && <CreateDialog onClose={() => setOpen(false)} />}
    </>
  );
}
