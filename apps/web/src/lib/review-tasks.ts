import "server-only";

import { requireViewer } from "@/lib/auth";

export interface ReviewApplicationOption {
  appliedAt: string | null;
  company: string;
  createdAt: string;
  id: string;
  originalUrl: string | null;
  position: string;
  status: "SAVED" | "APPLIED" | "ASSESSMENT" | "INTERVIEW" | "OFFER" | "REJECTED" | "WITHDRAWN" | "NEEDS_REVIEW";
}

export interface ReviewTaskItem {
  event: {
    classification: string;
    evidence: string;
    extractedCompany: string | null;
    extractedJobId: string | null;
    extractedPosition: string | null;
    receivedAt: string;
    sender: string | null;
    subject: string;
  };
  id: string;
  reason: string;
  suggestedApplicationIds: string[];
}

export interface IgnoredEmailItem {
  bodyPreview: string | null;
  evidence: string;
  id: string;
  receivedAt: string;
  sender: string | null;
  subject: string;
}

export async function listOpenReviewTasks(): Promise<{
  applications: ReviewApplicationOption[];
  ignoredEmails: IgnoredEmailItem[];
  tasks: ReviewTaskItem[];
}> {
  const { supabase, viewer } = await requireViewer();
  const { data: taskRows, error: taskError } = await supabase
    .from("review_tasks")
    .select("id,email_event_id,suggested_application_ids,reason")
    .eq("user_id", viewer.id)
    .eq("status", "OPEN")
    .order("created_at", { ascending: false });

  if (taskError) throw new Error(`Unable to load review tasks: ${taskError.message}`);

  const eventIds = taskRows.map((task) => task.email_event_id);
  const eventById = new Map<string, ReviewTaskItem["event"]>();
  if (eventIds.length > 0) {
    const { data: events, error: eventError } = await supabase
      .from("email_events")
      .select("id,classification,evidence,extracted_company,extracted_job_id,extracted_position,received_at,sender,subject")
      .eq("user_id", viewer.id)
      .in("id", eventIds);
    if (eventError) throw new Error(`Unable to load review email details: ${eventError.message}`);
    events.forEach((event) => eventById.set(event.id, {
      classification: event.classification,
      evidence: event.evidence,
      extractedCompany: event.extracted_company,
      extractedJobId: event.extracted_job_id,
      extractedPosition: event.extracted_position,
      receivedAt: event.received_at,
      sender: event.sender,
      subject: event.subject,
    }));
  }

  const { data: applications, error: applicationError } = await supabase
    .from("applications")
    .select("id,company,position,status,original_url,applied_at,created_at")
    .eq("user_id", viewer.id)
    .order("updated_at", { ascending: false });
  if (applicationError) throw new Error(`Unable to load application choices: ${applicationError.message}`);

  const { data: ignoredEmails, error: ignoredError } = await supabase
    .from("email_events")
    .select("id,body_preview,evidence,received_at,sender,subject")
    .eq("user_id", viewer.id)
    .eq("classification", "NOT_JOB_RELATED")
    .eq("review_status", "NOT_REQUIRED")
    .is("application_id", null)
    .order("received_at", { ascending: false })
    .limit(50);
  if (ignoredError) throw new Error(`Unable to load ignored emails: ${ignoredError.message}`);

  return {
    applications: applications.map((application) => ({
      appliedAt: application.applied_at,
      company: application.company,
      createdAt: application.created_at,
      id: application.id,
      originalUrl: application.original_url,
      position: application.position,
      status: application.status,
    })),
    ignoredEmails: ignoredEmails.map((email) => ({
      bodyPreview: email.body_preview,
      evidence: email.evidence,
      id: email.id,
      receivedAt: email.received_at,
      sender: email.sender,
      subject: email.subject,
    })),
    tasks: taskRows.flatMap((task) => {
      const event = eventById.get(task.email_event_id);
      return event ? [{
        event,
        id: task.id,
        reason: task.reason,
        suggestedApplicationIds: task.suggested_application_ids,
      }] : [];
    }),
  };
}
