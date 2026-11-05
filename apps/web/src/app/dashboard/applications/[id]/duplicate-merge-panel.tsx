"use client";

import { useActionState } from "react";
import type { ApplicationOption } from "@/lib/applications";
import { formatDateTime, titleCase } from "@/lib/format";
import { mergeDuplicateApplicationAction, type ApplicationActionState } from "../../actions";
import { useViewerTimeZone } from "../../local-date";

const initialState: ApplicationActionState = {};

export function DuplicateMergePanel({
  applicationId,
  applications,
}: {
  applicationId: string;
  applications: ApplicationOption[];
}) {
  const alternatives = applications.filter((application) => application.id !== applicationId);
  const [state, submit, pending] = useActionState(mergeDuplicateApplicationAction, initialState);
  const timeZone = useViewerTimeZone();

  if (alternatives.length === 0) return null;

  return (
    <article className="panel side-panel duplicate-merge-panel">
      <h2>Duplicate application</h2>
      <p>Choose another entry only when it represents this exact same job posting.</p>
      <form action={submit} className="stack-form" onSubmit={(event) => {
        if (!window.confirm(
          "Consolidate this duplicate here? Its PDFs, files, actions, and timeline will move here, then the duplicate entry will be deleted.",
        )) event.preventDefault();
      }}>
        <input name="applicationId" type="hidden" value={applicationId} />
        <label>Entry to consolidate
          <select defaultValue="" name="mergeApplicationId" required>
            <option disabled value="">Choose a duplicate…</option>
            {alternatives.map((application) => (
              <option key={application.id} value={application.id}>
                {application.company} — {application.position} · {titleCase(application.status)} · {formatDateTime(application.appliedAt ?? application.createdAt, undefined, timeZone)}
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
