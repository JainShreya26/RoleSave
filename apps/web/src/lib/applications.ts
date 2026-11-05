import "server-only";

import { applicationStatuses, type ApplicationStatus } from "@rolesave/types";
import { notFound } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import type { ApplicationEventRow, ApplicationRow, DocumentRow } from "@/lib/supabase/database.types";
import { fetchAllRows } from "@/lib/supabase/fetch-all";

export interface ApplicationListItem extends ApplicationRow {
  document_status: "PENDING" | "PROCESSING" | "COMPLETE" | "FAILED" | null;
}

export interface ApplicationOption {
  appliedAt: string | null;
  company: string;
  createdAt: string;
  id: string;
  position: string;
  status: ApplicationStatus;
}

export type ApplicationDetailItem = Pick<
  ApplicationRow,
  "applied_at" | "company" | "created_at" | "id" | "job_id" | "original_url" | "position" | "status" | "triage_decision" | "triage_reason" | "updated_at"
>;

export interface ApplicationDocumentItem {
  capture_status: DocumentRow["capture_status"];
  id: string;
  pdf_available: boolean;
  saved_at: string;
}

export type ApplicationTimelineItem = Pick<
  ApplicationEventRow,
  "event_time" | "event_type" | "evidence" | "id" | "new_status" | "source"
>;

function mostRecentlyUpdatedFirst(left: { updated_at: string }, right: { updated_at: string }) {
  return Date.parse(right.updated_at) - Date.parse(left.updated_at);
}

function isApplicationStatus(value: string | undefined): value is ApplicationStatus {
  return applicationStatuses.includes(value as ApplicationStatus);
}

export async function listApplications(status?: string): Promise<ApplicationListItem[]> {
  const { supabase, viewer } = await requireViewer();
  const { data, error } = await fetchAllRows((from, to) => {
    let query = supabase.from("applications").select("*").eq("user_id", viewer.id);
    if (isApplicationStatus(status)) {
      query = query.eq("status", status);
    }
    return query.order("id").range(from, to);
  });
  if (error) {
    throw new Error(`Unable to load applications: ${error.message}`);
  }

  const documentStatus = new Map<string, ApplicationListItem["document_status"]>();

  if (data.length > 0) {
    // Read by user rather than listing every application ID: enough IDs make
    // the request too long for the server, which is refused outright.
    const { data: documents, error: documentError } = await fetchAllRows((from, to) => supabase
      .from("documents")
      .select("application_id,capture_status")
      .eq("user_id", viewer.id)
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, to));

    if (documentError) {
      throw new Error(`Unable to load document states: ${documentError.message}`);
    }

    documents.forEach((document) => {
      if (!documentStatus.has(document.application_id)) {
        documentStatus.set(document.application_id, document.capture_status);
      }
    });
  }

  return data
    .map((application) => ({
      ...application,
      triage_decision: application.triage_decision ?? null,
      triage_reason: application.triage_reason ?? null,
      document_status: documentStatus.get(application.id) ?? null,
    }))
    .sort(mostRecentlyUpdatedFirst);
}

export async function getApplicationDetail(id: string, featuresAvailable = true): Promise<{
  application: ApplicationDetailItem;
  applicationOptions: ApplicationOption[];
  documents: ApplicationDocumentItem[];
  events: ApplicationTimelineItem[];
}> {
  const { supabase, viewer } = await requireViewer();
  const { data: baseApplication, error } = await supabase
    .from("applications")
    .select("id,company,position,status,original_url,job_id,applied_at,created_at,updated_at")
    .eq("id", id)
    .eq("user_id", viewer.id)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load the application: ${error.message}`);
  }
  if (!baseApplication) {
    notFound();
  }

  let triage: Pick<ApplicationDetailItem, "triage_decision" | "triage_reason"> = {
    triage_decision: null,
    triage_reason: null,
  };
  if (featuresAvailable) {
    const { data, error: triageError } = await supabase
      .from("applications")
      .select("triage_decision,triage_reason")
      .eq("id", id)
      .eq("user_id", viewer.id)
      .single();
    if (triageError) throw new Error(`Unable to load the role decision: ${triageError.message}`);
    triage = data;
  }
  const application: ApplicationDetailItem = { ...baseApplication, ...triage };

  const { data: events, error: eventsError } = await fetchAllRows((from, to) => supabase
    .from("application_events")
    .select("id,event_type,event_time,source,evidence,new_status")
    .eq("application_id", id)
    .eq("user_id", viewer.id)
    .order("event_time", { ascending: false })
    .order("id")
    .range(from, to));

  if (eventsError) {
    throw new Error(`Unable to load the timeline: ${eventsError.message}`);
  }

  const { data: applicationRows, error: applicationOptionsError } = await fetchAllRows((from, to) => supabase
    .from("applications")
    .select("id,company,position,status,applied_at,created_at,updated_at")
    .eq("user_id", viewer.id)
    .order("id")
    .range(from, to));
  if (applicationOptionsError) {
    throw new Error(`Unable to load application choices: ${applicationOptionsError.message}`);
  }

  // A merge can leave a role with several documents, newest first.
  const { data: documentRows, error: documentsError } = await fetchAllRows((from, to) => supabase
    .from("documents")
    .select("id,capture_status,storage_path,captured_at,created_at")
    .eq("application_id", id)
    .eq("user_id", viewer.id)
    .order("created_at", { ascending: false })
    .order("id")
    .range(from, to));

  if (documentsError) {
    throw new Error(`Unable to load job descriptions: ${documentsError.message}`);
  }

  // Signing shows whether each finished PDF can be opened. The page does not keep
  // these links, because they expire. The document route signs a new one on each click.
  const openablePaths = new Set<string>();
  const completePaths = documentRows.filter((row) => row.capture_status === "COMPLETE").map((row) => row.storage_path);
  if (completePaths.length > 0) {
    const { data: signed, error: signedUrlError } = await supabase.storage
      .from("job-descriptions")
      .createSignedUrls(completePaths, 60);
    if (signedUrlError) {
      console.error(`Unable to check documents for application ${id}: ${signedUrlError.message}`);
    }
    for (const item of signed ?? []) {
      if (item.path && item.signedUrl) openablePaths.add(item.path);
      else console.error(`Unable to open a document for application ${id}: ${item.error}`);
    }
  }
  const documents: ApplicationDocumentItem[] = documentRows.map((row) => ({
    capture_status: row.capture_status,
    id: row.id,
    pdf_available: openablePaths.has(row.storage_path),
    saved_at: row.captured_at ?? row.created_at,
  }));

  return {
    application,
    applicationOptions: [...applicationRows].sort(mostRecentlyUpdatedFirst).map((row) => ({
      appliedAt: row.applied_at,
      company: row.company,
      createdAt: row.created_at,
      id: row.id,
      position: row.position,
      status: row.status,
    })),
    documents,
    events,
  };
}
