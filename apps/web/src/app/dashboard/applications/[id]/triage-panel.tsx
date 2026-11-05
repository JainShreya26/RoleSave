"use client";

import { useActionState } from "react";
import type { ApplicationDetailItem } from "@/lib/applications";
import { saveTriageAction } from "../../triage-actions";
import type { ApplicationActionState } from "../../actions";

const initialState: ApplicationActionState = {};

export function TriagePanel({ application }: { application: ApplicationDetailItem }) {
  const [state, submit, pending] = useActionState(saveTriageAction, initialState);
  if (application.status !== "SAVED") return null;

  return <article className="panel side-panel">
    <h2>Worth pursuing?</h2>
    <form action={submit} className="stack-form triage-form">
      <input name="applicationId" type="hidden" value={application.id} />
      <label>Decision
        {/* React resets this form after saving, and a select resets to the value it was
            created with. The key recreates it with the saved decision. */}
        <select defaultValue={application.triage_decision ?? ""} key={application.triage_decision ?? ""} name="decision">
          <option value="">Not reviewed</option>
          <option value="PURSUE">Pursue</option>
          <option value="MAYBE">Maybe</option>
          <option value="PASS">Pass</option>
        </select>
      </label>
      <label>Reason (optional)
        <textarea defaultValue={application.triage_reason ?? ""} maxLength={500} name="reason" placeholder="What shaped your decision?" rows={3} />
      </label>
      <button className="secondary-button" disabled={pending} type="submit">{pending ? "Saving…" : "Save decision"}</button>
      {state.message && <p aria-live="polite" className={`form-message ${state.success ? "success" : "error"}`}>{state.message}</p>}
    </form>
  </article>;
}
