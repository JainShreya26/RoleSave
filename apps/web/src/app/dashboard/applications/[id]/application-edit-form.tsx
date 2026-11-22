"use client";

import { selectableApplicationStatuses, type ApplicationStatus } from "@rolesave/types";
import { startTransition, useActionState, useState } from "react";
import {
  changeStatusAction,
  deleteApplicationAction,
  updateApplicationAction,
  type ApplicationActionState,
} from "../../actions";
import { DateTimeField, submitKeepingValues, TextField } from "../../application-fields";
import { ConfirmDialog } from "../../confirm-dialog";
import type { ApplicationDetailItem } from "@/lib/applications";
import { deleteConfirmation } from "@/lib/delete-confirmation";
import { titleCase } from "@/lib/format";
import { statusTone } from "@/lib/role-list";

const initialState: ApplicationActionState = {};

export function ApplicationEditForm({ application }: { application: ApplicationDetailItem }) {
  const [state, action, pending] = useActionState(updateApplicationAction, initialState);

  return (
    <form action={action} className="stack-form application-form detail-form" onSubmit={submitKeepingValues(action)}>
      <input name="applicationId" type="hidden" value={application.id} />
      <div className="form-grid">
        <TextField defaultValue={application.company} errors={state.errors} label="Company" maxLength={200} name="company" required />
        <TextField defaultValue={application.position} errors={state.errors} label="Position" maxLength={300} name="position" required />
        <DateTimeField defaultValue={application.applied_at} errors={state.errors} label="Date applied" name="appliedAt" />
        <TextField defaultValue={application.job_id ?? ""} errors={state.errors} label="Job or requisition ID" maxLength={200} name="jobId" optional />
        <TextField defaultValue={application.original_url ?? ""} errors={state.errors} label="Job posting link" name="originalUrl" optional placeholder="https://…" type="url" wide />
      </div>
      {state.errors && <p className="form-message error">Fix the highlighted fields and try again.</p>}
      {state.message && <p aria-live="polite" className={state.success ? "form-message success" : "form-message error"}>{state.message}</p>}
      <div className="form-actions"><button className="primary-button" disabled={pending} type="submit">{pending ? "Saving…" : "Save details"}</button></div>
    </form>
  );
}

/** The role's status. Choosing another saves it at once, as it does in the roles table. */
export function StatusControl({ application }: { application: ApplicationDetailItem }) {
  const [state, action, pending] = useActionState(changeStatusAction, initialState);
  // A choice shows only until the server answers. After that the page shows what is stored.
  const [choice, setChoice] = useState<{ answeredBy: ApplicationActionState; from: ApplicationStatus; to: ApplicationStatus } | null>(null);
  const shown = choice && choice.answeredBy === state && choice.from === application.status ? choice.to : application.status;
  const selectable = selectableApplicationStatuses.some((item) => item === shown);

  function change(next: ApplicationStatus) {
    setChoice({ answeredBy: state, from: application.status, to: next });
    const data = new FormData();
    data.set("applicationId", application.id);
    data.set("status", next);
    startTransition(() => action(data));
  }

  return (
    <div className="detail-status">
      <span className={`status status-select ${statusTone(shown)}`}>
        <i />
        <select aria-label="Status" autoComplete="off" disabled={pending} onChange={(event) => change(event.target.value as ApplicationStatus)} value={shown}>
          {!selectable && <option disabled value={shown}>{titleCase(shown)}</option>}
          {selectableApplicationStatuses.map((status) => <option key={status} value={status}>{titleCase(status)}</option>)}
        </select>
      </span>
      {state.message && !state.success && <p className="form-message error" role="alert">{state.message}</p>}
      <span aria-live="polite" className="visually-hidden">{!pending && state.success ? state.message : ""}</span>
    </div>
  );
}

export function DeleteApplicationButton({ applicationId, name }: { applicationId: string; name: string }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const content = deleteConfirmation([name]);
  return (
    <>
      <button className="danger-button" onClick={() => setDialogOpen(true)} type="button">Delete role…</button>
      {dialogOpen && (
        <ConfirmDialog
          action={(formData) => deleteApplicationAction(applicationId, formData)}
          confirmLabel={content.confirmLabel}
          description={content.description}
          items={content.names.map((item) => ({ name: item }))}
          listLabel="Role selected for deletion"
          onClose={() => setDialogOpen(false)}
          title={content.title}
        />
      )}
    </>
  );
}
