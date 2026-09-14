"use client";

import { selectableApplicationStatuses } from "@rolesave/types";
import { useActionState } from "react";
import {
  changeStatusAction,
  deleteApplicationAction,
  updateApplicationAction,
  type ApplicationActionState,
} from "../../actions";
import type { ApplicationDetailItem } from "@/lib/applications";
import { titleCase, toDateTimeLocal } from "@/lib/format";

const initialState: ApplicationActionState = {};

export function ApplicationEditForm({ application }: { application: ApplicationDetailItem }) {
  const updateAction = updateApplicationAction.bind(null, application.id);
  const [state, action, pending] = useActionState(updateAction, initialState);

  return (
    <form action={action} className="stack-form application-form detail-form">
      <div className="form-grid">
        <label>Company<input defaultValue={application.company} name="company" required /></label>
        <label>Position<input defaultValue={application.position} name="position" required /></label>
        <label>Applied at<input defaultValue={toDateTimeLocal(application.applied_at)} name="appliedAt" type="datetime-local" /></label>
        <label>Job or requisition ID<input defaultValue={application.job_id ?? ""} name="jobId" /></label>
        <label className="wide">Original URL<input defaultValue={application.original_url ?? ""} name="originalUrl" type="url" /></label>
      </div>
      {state.errors && <p className="form-message error">Check the application details and try again.</p>}
      {state.message && <p aria-live="polite" className={state.success ? "form-message success" : "form-message error"}>{state.message}</p>}
      <div className="form-actions"><button className="primary-button" disabled={pending} type="submit">{pending ? "Saving…" : "Save details"}</button></div>
    </form>
  );
}

export function StatusForm({ application }: { application: ApplicationDetailItem }) {
  const statusAction = changeStatusAction.bind(null, application.id);
  const [state, action, pending] = useActionState(statusAction, initialState);

  return (
    <form action={action} className="status-form">
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
      if (!window.confirm("Delete this application and its timeline? This cannot be undone.")) event.preventDefault();
    }}>
      <button className="danger-button" type="submit">Delete application</button>
    </form>
  );
}
