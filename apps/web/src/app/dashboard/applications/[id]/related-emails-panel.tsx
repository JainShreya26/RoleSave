"use client";

import { useActionState } from "react";
import { formatDateTime, titleCase } from "@/lib/format";
import type { ApplicationEmailOption, RelatedEmailItem } from "@/lib/applications";
import {
  reassignEmailMatchAction,
  undoEmailMatchAction,
  type EmailMatchActionState,
} from "./email-match-actions";

const initialState: EmailMatchActionState = {};

function EmailMatchControls({
  applicationId,
  applications,
  email,
}: {
  applicationId: string;
  applications: ApplicationEmailOption[];
  email: RelatedEmailItem;
}) {
  const reassignAction = reassignEmailMatchAction.bind(null, applicationId);
  const undoAction = undoEmailMatchAction.bind(null, applicationId);
  const [reassignState, submitReassignment, reassigning] = useActionState(reassignAction, initialState);
  const [undoState, submitUndo, undoing] = useActionState(undoAction, initialState);
  const alternatives = applications.filter((application) => application.id !== applicationId);
  const state = reassignState.message ? reassignState : undoState;

  return (
    <div className="email-match-controls">
      {alternatives.length > 0 && (
        <form action={submitReassignment} className="email-reassign-form">
          <input name="emailEventId" type="hidden" value={email.id} />
          <label>Move this email
            <select defaultValue="" name="applicationId" required>
              <option disabled value="">Choose another application…</option>
              {alternatives.map((application) => (
                <option key={application.id} value={application.id}>
                  {application.company} — {application.position} · {titleCase(application.status)} · {formatDateTime(application.appliedAt ?? application.createdAt)}
                </option>
              ))}
            </select>
          </label>
          <button className="secondary-button" disabled={reassigning || undoing} type="submit">
            {reassigning ? "Moving…" : "Move email"}
          </button>
        </form>
      )}
      <form action={submitUndo} onSubmit={(event) => {
        if (!window.confirm("Detach this email and return it to Needs Review?")) event.preventDefault();
      }}>
        <input name="emailEventId" type="hidden" value={email.id} />
        <button className="text-button" disabled={undoing || reassigning} type="submit">
          {undoing ? "Undoing…" : "Undo match"}
        </button>
      </form>
      {state.message && (
        <p aria-live="polite" className={`form-message ${state.success ? "success" : "error"}`}>
          {state.message}
        </p>
      )}
    </div>
  );
}

export function RelatedEmailsPanel({
  applicationId,
  applications,
  emails,
}: {
  applicationId: string;
  applications: ApplicationEmailOption[];
  emails: RelatedEmailItem[];
}) {
  return (
    <article className="panel related-emails-panel" id="related-emails">
      <div className="panel-heading">
        <div>
          <h2>Related emails</h2>
          <p>Messages attached to this application, with correction controls.</p>
        </div>
        <span className="review-count">{emails.length}</span>
      </div>
      {emails.length === 0 ? (
        <div className="empty-state compact"><p>No email has been attached to this application.</p></div>
      ) : (
        <div className="related-email-list">
          {emails.map((email) => (
            <section className="related-email-item" key={email.id}>
              <div className="related-email-heading">
                <span className="status blue"><i />{titleCase(email.classification)}</span>
                <time>{formatDateTime(email.receivedAt)}</time>
              </div>
              <h3>{email.subject || "No subject"}</h3>
              <p>From {email.sender ?? "Unknown sender"}</p>
              <blockquote>{email.evidence}</blockquote>
              <EmailMatchControls
                applicationId={applicationId}
                applications={applications}
                email={email}
              />
            </section>
          ))}
        </div>
      )}
    </article>
  );
}
