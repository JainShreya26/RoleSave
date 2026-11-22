import { isUuid } from "@rolesave/validation";

/** Fired in the browser after a failed save is queued again, so counts can refresh. */
export const capturesChangedEvent = "rolesave:captures-changed";

export interface FailedJobItem {
  attemptCount: number;
  company: string | null;
  failedAt: string | null;
  id: string;
  kind: "CAPTURE";
  lastError: string;
  position: string | null;
  replayId: string;
}

export const failedJobsEmptyMessage = "Failed captures that need attention will appear here.";

interface FailedCaptureRow {
  application_id: string;
  attempt_count: number;
  document_id: string;
  failed_at: string | null;
  id: string;
  last_error: string | null;
}

interface FailedJobApplication {
  company: string;
  id: string;
  position: string;
}

export function buildFailedJobItems(
  captures: FailedCaptureRow[],
  applicationRows: FailedJobApplication[],
): FailedJobItem[] {
  const applications = new Map(applicationRows.map((application) => [application.id, application]));

  return captures
    .map((job): FailedJobItem => {
      const application = applications.get(job.application_id);
      return {
        attemptCount: job.attempt_count,
        company: application?.company ?? null,
        failedAt: job.failed_at,
        id: job.id,
        kind: "CAPTURE",
        lastError: job.last_error ?? "Capture processing failed.",
        position: application?.position ?? null,
        replayId: job.document_id,
      };
    })
    .sort((left, right) => (right.failedAt ?? "").localeCompare(left.failedAt ?? ""));
}

export function formatProcessingAttempts(attemptCount: number): string {
  if (attemptCount === 0) return "No processing attempts";
  return `${attemptCount} processing attempt${attemptCount === 1 ? "" : "s"}`;
}

export function formatFailedJobsCount(jobCount: number): string {
  return `${jobCount} failed`;
}

export function validatedCaptureReplayId(kind: unknown, replayId: unknown): string | null {
  return kind === "CAPTURE" && isUuid(replayId) ? replayId : null;
}
