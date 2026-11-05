"use client";

import { useActionState } from "react";
import type { ApplicationActionState } from "./actions";
import { quickTriageAction } from "./triage-actions";

const initialState: ApplicationActionState = {};

export function QuickTriage({ applicationId, company, position, decision }: {
  applicationId: string;
  company: string;
  position: string;
  decision: "PURSUE" | "MAYBE" | "PASS" | null;
}) {
  const [state, submit, pending] = useActionState(quickTriageAction, initialState);
  return <div>
    <form action={submit} className="quick-triage">
      <input name="applicationId" type="hidden" value={applicationId} />
      {/* React resets this form after saving, and a select resets to the value it was
          created with. The key recreates it with the saved decision. */}
      <select aria-label={`Decision for ${company} ${position}`} defaultValue={decision ?? ""} key={decision ?? ""} name="decision">
        <option value="">Not reviewed</option><option value="PURSUE">Pursue</option><option value="MAYBE">Maybe</option><option value="PASS">Pass</option>
      </select><button className="secondary-button" disabled={pending} type="submit">{pending ? "…" : "Save"}</button>
    </form>
    {state.message && <small aria-live="polite" className={state.success ? "quick-message success" : "quick-message error"}>{state.message}</small>}
  </div>;
}
