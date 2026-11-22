"use client";

import { useActionState, useEffect } from "react";
import { capturesChangedEvent, formatProcessingAttempts, type FailedJobItem } from "@/lib/failed-job-features";
import { LocalDate } from "../local-date";
import { retryFailedJobAction, type RetryFailedJobActionState } from "./actions";

const initialState: RetryFailedJobActionState = {};

export function FailedJobCard({ job }: { job: FailedJobItem }) {
  const [state, action, pending] = useActionState(retryFailedJobAction, initialState);
  useEffect(() => {
    if (state.success) window.dispatchEvent(new Event(capturesChangedEvent));
  }, [state]);
  const title = `${job.company ?? "Application"} — ${job.position ?? "job description"}`;

  return (
    <article className="panel failed-job-card">
      <div>
        <div className="failed-job-heading">
          <span className="status rose"><i />PDF capture</span>
          <LocalDate value={job.failedAt} withTime />
        </div>
        <h2>{title}</h2>
        <p className="failed-job-error">{job.lastError}</p>
        <small>{formatProcessingAttempts(job.attemptCount)}</small>
      </div>
      <div className="failed-job-actions">
        <form action={action}>
          <input name="kind" type="hidden" value={job.kind} />
          <input name="replayId" type="hidden" value={job.replayId} />
          <button className="secondary-button" disabled={pending} type="submit">
            {pending ? "Queueing…" : "Retry job"}
          </button>
        </form>
        {state.message && (
          <p aria-live="polite" className={`form-message ${state.success ? "success" : "error"}`}>
            {state.message}
          </p>
        )}
      </div>
    </article>
  );
}
