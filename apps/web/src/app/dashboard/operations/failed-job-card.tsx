"use client";

import { useActionState } from "react";
import { formatDateTime } from "@/lib/format";
import type { FailedJobItem } from "@/lib/failed-jobs";
import { retryFailedJobAction, type RetryFailedJobActionState } from "./actions";

const initialState: RetryFailedJobActionState = {};

export function FailedJobCard({ job }: { job: FailedJobItem }) {
  const [state, action, pending] = useActionState(retryFailedJobAction, initialState);
  const title = job.kind === "CAPTURE"
    ? `${job.company ?? "Application"} — ${job.position ?? "job description"}`
    : "Inbound email";

  return (
    <article className="panel failed-job-card">
      <div>
        <div className="failed-job-heading">
          <span className="status rose"><i />{job.kind === "CAPTURE" ? "PDF capture" : "Email processing"}</span>
          <time>{formatDateTime(job.failedAt)}</time>
        </div>
        <h2>{title}</h2>
        <p className="failed-job-error">{job.lastError}</p>
        <small>{job.attemptCount} processing attempt{job.attemptCount === 1 ? "" : "s"}</small>
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
