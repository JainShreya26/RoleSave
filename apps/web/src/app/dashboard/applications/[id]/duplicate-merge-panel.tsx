"use client";

import { useRef, useState } from "react";
import type { ApplicationOption } from "@/lib/applications";
import { formatDateTime, titleCase } from "@/lib/format";
import { mergeDuplicateApplicationAction, type ApplicationActionState } from "../../actions";
import { ConfirmDialog } from "../../confirm-dialog";
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
  const [state, setState] = useState(initialState);
  const [merging, setMerging] = useState<ApplicationOption | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const timeZone = useViewerTimeZone();
  const describe = (application: ApplicationOption) =>
    `${titleCase(application.status)} · ${formatDateTime(application.appliedAt ?? application.createdAt, undefined, timeZone)}`;

  if (alternatives.length === 0) return null;

  return (
    // Rarely needed, so it stays folded until someone goes looking for it.
    <details className="panel side-panel duplicate-merge-panel">
      <summary><h2>Saved this role twice?</h2></summary>
      <p>Consolidate the other entry into this one. Only do this when both are the exact same job posting.</p>
      <form className="stack-form" onSubmit={(event) => {
        event.preventDefault();
        const chosen = new FormData(event.currentTarget).get("mergeApplicationId");
        setMerging(alternatives.find((application) => application.id === chosen) ?? null);
      }} ref={form}>
        <input name="applicationId" type="hidden" value={applicationId} />
        <label>Other entry
          <select defaultValue="" name="mergeApplicationId" required>
            <option disabled value="">Choose a duplicate…</option>
            {alternatives.map((application) => (
              <option key={application.id} value={application.id}>
                {application.company} · {application.position} · {describe(application)}
              </option>
            ))}
          </select>
        </label>
        <button className="secondary-button" type="submit">Consolidate duplicate</button>
        {state.message && (
          <p aria-live="polite" className={`form-message ${state.success ? "success" : "error"}`}>
            {state.message}
          </p>
        )}
      </form>
      {merging && (
        <ConfirmDialog
          action={async (formData) => {
            const result = await mergeDuplicateApplicationAction(initialState, formData);
            setState(result);
            // The merged role is gone from the list, and the browser would otherwise pick another in its place.
            if (result.success) form.current?.reset();
          }}
          confirmLabel="Consolidate duplicate"
          description="Its PDFs, files, actions, and timeline will move here, then the duplicate entry will be deleted."
          eyebrow="Consolidate duplicate"
          items={[{ detail: describe(merging), name: `${merging.company}, ${merging.position}` }]}
          listLabel="Duplicate to consolidate"
          onClose={() => setMerging(null)}
          pendingLabel="Consolidating…"
          title="Consolidate this duplicate?"
        >
          <input name="applicationId" type="hidden" value={applicationId} />
          <input name="mergeApplicationId" type="hidden" value={merging.id} />
        </ConfirmDialog>
      )}
    </details>
  );
}
