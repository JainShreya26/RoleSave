"use client";

import { selectableApplicationStatuses } from "@rolesave/types";
import { useActionState } from "react";
import {
  changeStatusAction,
  deleteApplicationAction,
  updateApplicationAction,
  type ApplicationActionState,
} from "../../actions";
import { DateTimeField, submitKeepingValues, TextField } from "../../application-fields";
import type { ApplicationDetailItem } from "@/lib/applications";
import { titleCase } from "@/lib/format";

const initialState: ApplicationActionState = {};

export function ApplicationEditForm({ application }: { application: ApplicationDetailItem }) {
  const [state, action, pending] = useActionState(updateApplicationAction, initialState);

  return (
    <form action={action} className="stack-form application-form detail-form" onSubmit={submitKeepingValues(action)}>
      <input name="applicationId" type="hidden" value={application.id} />
      <div className="form-grid">
        <TextField defaultValue={application.company} errors={state.errors} label="Company" maxLength={200} name="company" required />
        <TextField defaultValue={application.position} errors={state.errors} label="Position" maxLength={300} name="position" required />
        <DateTimeField defaultValue={application.applied_at} errors={state.errors} label="Applied at" name="appliedAt" />
        <TextField defaultValue={application.job_id ?? ""} errors={state.errors} label="Job or requisition ID" maxLength={200} name="jobId" />
        <TextField defaultValue={application.original_url ?? ""} errors={state.errors} label="Original URL" name="originalUrl" type="url" wide />
      </div>
      {state.errors && <p className="form-message error">Fix the highlighted fields and try again.</p>}
      {state.message && <p aria-live="polite" className={state.success ? "form-message success" : "form-message error"}>{state.message}</p>}
      <div className="form-actions"><button className="primary-button" disabled={pending} type="submit">{pending ? "Saving…" : "Save details"}</button></div>
    </form>
  );
}

export function StatusForm({ application }: { application: ApplicationDetailItem }) {
  const [state, action, pending] = useActionState(changeStatusAction, initialState);

  return (
    <form action={action} className="status-form" onSubmit={submitKeepingValues(action)}>
      <input name="applicationId" type="hidden" value={application.id} />
      <label htmlFor="application-status">Current status</label>
      <div>
        <select defaultValue={application.status} id="application-status" name="status">
          {selectableApplicationStatuses.map((status) => <option key={status} value={status}>{titleCase(status)}</option>)}
        </select>
        <button className="secondary-button" disabled={pending} type="submit">{pending ? "Updating…" : "Update"}</button>
      </div>
      {state.message && <p aria-live="polite" className={state.success ? "form-message success" : "form-message error"}>{state.message}</p>}
    </form>
  );
}

export function DeleteApplicationForm({ applicationId }: { applicationId: string }) {
  const action = deleteApplicationAction.bind(null, applicationId);
  return (
    <form action={action} onSubmit={(event) => {
      if (!window.confirm("Delete this application with its timeline, actions, and files? This cannot be undone.")) event.preventDefault();
    }}>
      <button className="danger-button" type="submit">Delete application</button>
    </form>
  );
}
