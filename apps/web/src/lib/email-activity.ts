import "server-only";

import { requireViewer } from "@/lib/auth";

export const emailActivityStates = [
  "ALL",
  "RECEIVED",
  "PROCESSING",
  "MATCHED",
  "NEEDS_REVIEW",
  "IGNORED",
  "FAILED",
] as const;

export type EmailActivityState = Exclude<typeof emailActivityStates[number], "ALL">;

export interface EmailActivityItem {
  application: { company: string; id: string; position: string } | null;
  attemptCount: number;
  classification: string | null;
  evidence: string | null;
  id: string;
  lastError: string | null;
  occurredAt: string;
  sender: string | null;
  state: EmailActivityState;
  subject: string;
}

function activityState(event: {
  application_id: string | null;
  classification: string;
  review_status: string;
} | undefined, jobStatus: "PENDING" | "PROCESSING" | "COMPLETE" | "FAILED"): EmailActivityState {
  if (jobStatus === "FAILED") return "FAILED";
  if (jobStatus === "PENDING") return "RECEIVED";
  if (jobStatus === "PROCESSING") return "PROCESSING";
  if (!event) return "RECEIVED";
  if (event.application_id) return "MATCHED";
  if (event.review_status === "PENDING") return "NEEDS_REVIEW";
  return "IGNORED";
}

export async function listEmailActivity(): Promise<EmailActivityItem[]> {
  const { supabase, viewer } = await requireViewer();
  const [jobsResult, eventsResult] = await Promise.all([
    supabase
      .from("inbound_email_jobs")
      .select("id,status,attempt_count,last_error,created_at")
      .eq("user_id", viewer.id)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("email_events")
      .select("email_job_id,application_id,classification,evidence,received_at,review_status,sender,subject")
      .eq("user_id", viewer.id)
      .order("received_at", { ascending: false })
      .limit(200),
  ]);
  if (jobsResult.error) throw new Error(`Unable to load inbound email jobs: ${jobsResult.error.message}`);
  if (eventsResult.error) throw new Error(`Unable to load email events: ${eventsResult.error.message}`);

  const applicationIds = [...new Set(eventsResult.data.flatMap((event) => (
    event.application_id ? [event.application_id] : []
  )))];
  const applicationsResult = applicationIds.length === 0
    ? { data: [], error: null }
    : await supabase
        .from("applications")
        .select("id,company,position")
        .eq("user_id", viewer.id)
        .in("id", applicationIds);
  if (applicationsResult.error) {
    throw new Error(`Unable to load matched applications: ${applicationsResult.error.message}`);
  }

  const applicationById = new Map(applicationsResult.data.map((application) => [application.id, application]));
  const eventByJobId = new Map(eventsResult.data.map((event) => [event.email_job_id, event]));

  return jobsResult.data.map((job) => {
    const event = eventByJobId.get(job.id);
    return {
      application: event?.application_id ? applicationById.get(event.application_id) ?? null : null,
      attemptCount: job.attempt_count,
      classification: event?.classification ?? null,
      evidence: event?.evidence ?? null,
      id: job.id,
      lastError: job.last_error,
      occurredAt: event?.received_at ?? job.created_at,
      sender: event?.sender ?? null,
      state: activityState(event, job.status),
      subject: event?.subject || "Incoming email",
    };
  });
}
