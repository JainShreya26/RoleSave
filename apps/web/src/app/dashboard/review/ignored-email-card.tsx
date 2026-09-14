"use client";

import { useActionState } from "react";
import { formatDateTime } from "@/lib/format";
import type { IgnoredEmailItem, ReviewApplicationOption } from "@/lib/review-tasks";
import { restoreIgnoredEmailAction, type ReviewActionState } from "./actions";

const initialState: ReviewActionState = {};

export function IgnoredEmailCard({
  applications,
  email,
}: {
  applications: ReviewApplicationOption[];
  email: IgnoredEmailItem;
}) {
  const [state, action, pending] = useActionState(restoreIgnoredEmailAction, initialState);

  return (
    <article className="panel review-task-card ignored-email-card">
      <div className="review-task-summary">
        <div className="review-task-heading">
          <span className="status neutral"><i /> Ignored</span>
          <time>{formatDateTime(email.receivedAt)}</time>
        </div>
        <h2>{email.subject || "No subject"}</h2>
        <p className="review-sender">From {email.sender ?? "Unknown sender"}</p>
        <blockquote>{email.bodyPreview || email.evidence}</blockquote>
      </div>

      <div className="review-resolution">
        <p>RoleSave did not detect a recruiting event. Restore it if this email belongs to an application.</p>
        {applications.length > 0 ? (
          <form action={action} className="stack-form">
            <input name="emailEventId" type="hidden" value={email.id} />
            <label>Update type
              <select defaultValue="APPLICATION_CONFIRMED" name="classification">
                <option value="APPLICATION_CONFIRMED">Application confirmed</option>
                <option value="ASSESSMENT_REQUESTED">Assessment requested</option>
                <option value="INTERVIEW_REQUESTED">Interview requested</option>
                <option value="OFFER_RECEIVED">Offer received</option>
                <option value="REJECTION_RECEIVED">Rejection received</option>
                <option value="UNKNOWN_EMAIL_EVENT">General update</option>
              </select>
            </label>
            <label>Attach to application
              <select name="applicationId">
                {applications.map((application) => (
                  <option key={application.id} value={application.id}>
                    {application.company} — {application.position}
                  </option>
                ))}
              </select>
            </label>
            <button className="primary-button" disabled={pending} type="submit">
              {pending ? "Restoring…" : "Restore email"}
            </button>
          </form>
        ) : <p className="form-message error">Add an application before restoring this email.</p>}
        {state.message && (
          <p aria-live="polite" className={`form-message ${state.success ? "success" : "error"}`}>
            {state.message}
          </p>
        )}
      </div>
    </article>
  );
}
