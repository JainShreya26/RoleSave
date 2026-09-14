import "server-only";

import { requireViewer } from "@/lib/auth";

export interface FailedJobItem {
  attemptCount: number;
  company: string | null;
  failedAt: string | null;
  id: string;
  kind: "CAPTURE" | "EMAIL";
  lastError: string;
  position: string | null;
  replayId: string;
}

export async function listFailedJobs(): Promise<FailedJobItem[]> {
  const { supabase, viewer } = await requireViewer();
  const [captureResult, emailResult] = await Promise.all([
    supabase
      .from("capture_jobs")
      .select("id,application_id,document_id,attempt_count,last_error,failed_at")
      .eq("user_id", viewer.id)
      .eq("status", "FAILED")
      .order("failed_at", { ascending: false }),
    supabase
      .from("inbound_email_jobs")
      .select("id,attempt_count,last_error,failed_at")
      .eq("user_id", viewer.id)
      .eq("status", "FAILED")
      .order("failed_at", { ascending: false }),
  ]);
  if (captureResult.error) throw captureResult.error;
  if (emailResult.error) throw emailResult.error;

  const applicationIds = [...new Set(captureResult.data.map((job) => job.application_id))];
  const applicationsResult = applicationIds.length === 0
    ? { data: [], error: null }
    : await supabase
        .from("applications")
        .select("id,company,position")
        .eq("user_id", viewer.id)
        .in("id", applicationIds);
  if (applicationsResult.error) throw applicationsResult.error;
  const applications = new Map(applicationsResult.data.map((application) => [application.id, application]));

  return [
    ...captureResult.data.map((job): FailedJobItem => {
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
    }),
    ...emailResult.data.map((job): FailedJobItem => ({
      attemptCount: job.attempt_count,
      company: null,
      failedAt: job.failed_at,
      id: job.id,
      kind: "EMAIL",
      lastError: job.last_error ?? "Email processing failed.",
      position: null,
      replayId: job.id,
    })),
  ].sort((left, right) => (right.failedAt ?? "").localeCompare(left.failedAt ?? ""));
}
