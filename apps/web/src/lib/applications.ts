import "server-only";

import { applicationStatuses, type ApplicationStatus } from "@rolesave/types";
import { notFound } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import type { ApplicationEventRow, ApplicationRow, DocumentRow } from "@/lib/supabase/database.types";

export interface ApplicationListItem extends ApplicationRow {
  document_status: "PENDING" | "PROCESSING" | "COMPLETE" | "FAILED" | null;
  email_count: number;
  latest_email: {
    classification: string;
    received_at: string;
    subject: string;
  } | null;
}

export interface ApplicationEmailOption {
  appliedAt: string | null;
  company: string;
  createdAt: string;
  id: string;
  position: string;
  status: ApplicationStatus;
}

export type ApplicationDetailItem = Pick<
  ApplicationRow,
  "applied_at" | "company" | "created_at" | "id" | "job_id" | "original_url" | "position" | "status" | "updated_at"
>;

export interface ApplicationDocumentItem {
  capture_status: DocumentRow["capture_status"];
  id: string;
  signed_url: string | null;
}

export type ApplicationTimelineItem = Pick<
  ApplicationEventRow,
  "event_time" | "event_type" | "evidence" | "id" | "new_status" | "source"
>;

export interface RelatedEmailItem {
  classification: string;
  evidence: string;
  id: string;
  receivedAt: string;
  sender: string | null;
  subject: string;
}

function isApplicationStatus(value: string | undefined): value is ApplicationStatus {
  return applicationStatuses.includes(value as ApplicationStatus);
}

export async function listApplications(status?: string): Promise<ApplicationListItem[]> {
  const { supabase, viewer } = await requireViewer();
  let query = supabase
    .from("applications")
    .select("*")
    .eq("user_id", viewer.id)
    .order("updated_at", { ascending: false });

  if (isApplicationStatus(status)) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Unable to load applications: ${error.message}`);
  }

  const applicationIds = data.map((application) => application.id);
  const documentStatus = new Map<string, ApplicationListItem["document_status"]>();
  const emailCount = new Map<string, number>();
  const latestEmail = new Map<string, NonNullable<ApplicationListItem["latest_email"]>>();

  if (applicationIds.length > 0) {
    const { data: documents, error: documentError } = await supabase
      .from("documents")
      .select("application_id,capture_status")
      .eq("user_id", viewer.id)
      .in("application_id", applicationIds)
      .order("created_at", { ascending: false });

    if (documentError) {
      throw new Error(`Unable to load document states: ${documentError.message}`);
    }

    documents.forEach((document) => {
      if (!documentStatus.has(document.application_id)) {
        documentStatus.set(document.application_id, document.capture_status);
      }
    });

    const { data: emails, error: emailError } = await supabase
      .from("email_events")
      .select("application_id,classification,received_at,subject")
      .eq("user_id", viewer.id)
      .in("application_id", applicationIds)
      .order("received_at", { ascending: false });
    if (emailError) {
      throw new Error(`Unable to load application email activity: ${emailError.message}`);
    }
    emails.forEach((email) => {
      if (!email.application_id) return;
      emailCount.set(email.application_id, (emailCount.get(email.application_id) ?? 0) + 1);
      if (!latestEmail.has(email.application_id)) {
        latestEmail.set(email.application_id, {
          classification: email.classification,
          received_at: email.received_at,
          subject: email.subject,
        });
      }
    });
  }

  return data.map((application) => ({
    ...application,
    document_status: documentStatus.get(application.id) ?? null,
    email_count: emailCount.get(application.id) ?? 0,
    latest_email: latestEmail.get(application.id) ?? null,
  }));
}

export async function getApplicationDetail(id: string): Promise<{
  application: ApplicationDetailItem;
  applicationOptions: ApplicationEmailOption[];
  document?: ApplicationDocumentItem;
  events: ApplicationTimelineItem[];
  relatedEmails: RelatedEmailItem[];
}> {
  const { supabase, viewer } = await requireViewer();
  const { data: application, error } = await supabase
    .from("applications")
    .select("id,company,position,status,original_url,job_id,applied_at,created_at,updated_at")
    .eq("id", id)
    .eq("user_id", viewer.id)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load the application: ${error.message}`);
  }
  if (!application) {
    notFound();
  }

  const { data: events, error: eventsError } = await supabase
    .from("application_events")
    .select("id,event_type,event_time,source,evidence,new_status")
    .eq("application_id", id)
    .eq("user_id", viewer.id)
    .order("event_time", { ascending: false });

  if (eventsError) {
    throw new Error(`Unable to load the timeline: ${eventsError.message}`);
  }

  const { data: emailRows, error: emailError } = await supabase
    .from("email_events")
    .select("id,classification,evidence,received_at,sender,subject")
    .eq("application_id", id)
    .eq("user_id", viewer.id)
    .order("received_at", { ascending: false });
  if (emailError) {
    throw new Error(`Unable to load related emails: ${emailError.message}`);
  }

  const { data: applicationRows, error: applicationOptionsError } = await supabase
    .from("applications")
    .select("id,company,position,status,applied_at,created_at")
    .eq("user_id", viewer.id)
    .order("updated_at", { ascending: false });
  if (applicationOptionsError) {
    throw new Error(`Unable to load application choices: ${applicationOptionsError.message}`);
  }

  const { data: documentRows, error: documentsError } = await supabase
    .from("documents")
    .select("id,capture_status,storage_path")
    .eq("application_id", id)
    .eq("user_id", viewer.id)
    .order("created_at", { ascending: false })
    .limit(1);

  if (documentsError) {
    throw new Error(`Unable to load job descriptions: ${documentsError.message}`);
  }

  const latestDocument = documentRows[0];
  let document: ApplicationDocumentItem | undefined;
  if (latestDocument) {
    if (latestDocument.capture_status !== "COMPLETE") {
      document = {
        capture_status: latestDocument.capture_status,
        id: latestDocument.id,
        signed_url: null,
      };
    } else {
      const { data: signed, error: signedUrlError } = await supabase.storage
        .from("job-descriptions")
        .createSignedUrl(latestDocument.storage_path, 300);
      if (signedUrlError) {
        console.error(`Unable to sign document ${latestDocument.id}: ${signedUrlError.message}`);
      }
      document = {
        capture_status: latestDocument.capture_status,
        id: latestDocument.id,
        signed_url: signed?.signedUrl ?? null,
      };
    }
  }

  return {
    application,
    applicationOptions: applicationRows.map((row) => ({
      appliedAt: row.applied_at,
      company: row.company,
      createdAt: row.created_at,
      id: row.id,
      position: row.position,
      status: row.status,
    })),
    document,
    events,
    relatedEmails: emailRows.map((email) => ({
      classification: email.classification,
      evidence: email.evidence,
      id: email.id,
      receivedAt: email.received_at,
      sender: email.sender,
      subject: email.subject,
    })),
  };
}
