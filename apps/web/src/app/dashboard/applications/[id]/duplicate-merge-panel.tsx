"use client";

import { useActionState } from "react";
import type { ApplicationEmailOption } from "@/lib/applications";
import { formatDateTime, titleCase } from "@/lib/format";
import { mergeDuplicateApplicationAction, type ApplicationActionState } from "../../actions";

const initialState: ApplicationActionState = {};

export function DuplicateMergePanel({
  applicationId,
  applications,
}: {
  applicationId: string;
  applications: ApplicationEmailOption[];
}) {
  const alternatives = applications.filter((application) => application.id !== applicationId);
  const action = mergeDuplicateApplicationAction.bind(null, applicationId);
  const [state, submit, pending] = useActionState(action, initialState);

  if (alternatives.length === 0) return null;

  return (
    <article className="panel side-panel duplicate-merge-panel">
      <h2>Duplicate application</h2>
      <p>Choose another entry only when it represents this exact same job posting.</p>
      <form action={submit} className="stack-form" onSubmit={(event) => {
        if (!window.confirm(
          "Consolidate this duplicate here? Its PDFs, email matches, and timeline will move to this application, then the duplicate entry will be deleted.",
        )) event.preventDefault();
      }}>
        <label>Entry to consolidate
          <select defaultValue="" name="mergeApplicationId" required>
            <option disabled value="">Choose a duplicate…</option>
            {alternatives.map((application) => (
              <option key={application.id} value={application.id}>
                {application.company} — {application.position} · {titleCase(application.status)} · {formatDateTime(application.appliedAt ?? application.createdAt)}
              </option>
            ))}
          </select>
        </label>
        <button className="secondary-button" disabled={pending} type="submit">
          {pending ? "Consolidating…" : "Consolidate duplicate"}
        </button>
        {state.message && (
          <p aria-live="polite" className={`form-message ${state.success ? "success" : "error"}`}>
            {state.message}
          </p>
        )}
      </form>
    </article>
  );
}
