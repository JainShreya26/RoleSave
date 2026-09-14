"use client";

import { useActionState } from "react";
import { formatDateTime, titleCase } from "@/lib/format";
import type { ReviewApplicationOption, ReviewTaskItem } from "@/lib/review-tasks";
import { dismissReviewTaskAction, resolveReviewTaskAction, type ReviewActionState } from "./actions";

const initialState: ReviewActionState = {};

function applicationOptionLabel(application: ReviewApplicationOption, suggestionIndex: number) {
  let host = "No original URL";
  if (application.originalUrl) {
    try {
      host = new URL(application.originalUrl).hostname;
    } catch {
      host = "Invalid original URL";
    }
  }
  const ranking = suggestionIndex >= 0 ? `Suggested ${suggestionIndex + 1}` : "Other application";
  const relevantTime = application.appliedAt ?? application.createdAt;
  return `${ranking}: ${application.company} — ${application.position} · ${titleCase(application.status)} · ${formatDateTime(relevantTime)} · ${host}`;
}

export function ReviewTaskCard({
  applications,
  task,
}: {
  applications: ReviewApplicationOption[];
  task: ReviewTaskItem;
}) {
  const [resolveState, resolveAction, resolvePending] = useActionState(resolveReviewTaskAction, initialState);
  const [dismissState, dismissAction, dismissPending] = useActionState(dismissReviewTaskAction, initialState);
  const state = dismissState.message ? dismissState : resolveState;
  const orderedApplications = [...applications].sort((left, right) => {
    const leftIndex = task.suggestedApplicationIds.indexOf(left.id);
    const rightIndex = task.suggestedApplicationIds.indexOf(right.id);
    return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex)
      - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex);
  });

  return (
    <article className="panel review-task-card">
      <div className="review-task-summary">
        <div className="review-task-heading">
          <span className="status amber"><i /> {titleCase(task.event.classification)}</span>
          <time>{formatDateTime(task.event.receivedAt)}</time>
        </div>
        <h2>{task.event.subject || "No subject"}</h2>
        <p className="review-sender">From {task.event.sender ?? "Unknown sender"}</p>
        <blockquote>{task.event.evidence}</blockquote>
        <dl className="review-extracted">
          <div><dt>Company</dt><dd>{task.event.extractedCompany ?? "Not detected"}</dd></div>
          <div><dt>Position</dt><dd>{task.event.extractedPosition ?? "Not detected"}</dd></div>
          <div><dt>Job ID</dt><dd>{task.event.extractedJobId ?? "Not detected"}</dd></div>
        </dl>
      </div>

      <div className="review-resolution">
        <p>{task.reason}</p>
        {orderedApplications.length > 0 ? (
          <form action={resolveAction} className="stack-form">
            <input name="taskId" type="hidden" value={task.id} />
            <label>Match to application
              <select defaultValue="" name="applicationId" required>
                <option disabled value="">Choose the application you want to update…</option>
                {orderedApplications.map((application) => (
                  <option key={application.id} value={application.id}>
                    {applicationOptionLabel(
                      application,
                      task.suggestedApplicationIds.indexOf(application.id),
                    )}
                  </option>
                ))}
              </select>
            </label>
            <button className="primary-button" disabled={resolvePending || dismissPending} type="submit">
              {resolvePending ? "Confirming…" : "Confirm match"}
            </button>
          </form>
        ) : <p className="form-message error">Add an application before confirming this match.</p>}

        <form action={dismissAction} className="review-dismiss-form">
          <input name="taskId" type="hidden" value={task.id} />
          <button className="text-button" disabled={dismissPending || resolvePending} type="submit">
            {dismissPending ? "Dismissing…" : "Not job-related"}
          </button>
        </form>
        {state.message && <p aria-live="polite" className={`form-message ${state.success ? "success" : "error"}`}>{state.message}</p>}
      </div>
    </article>
  );
}
