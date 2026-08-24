import "server-only";

import { applicationStatuses, type ApplicationStatus } from "@manager/types";
import { notFound } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import type { ApplicationEventRow, ApplicationRow, DocumentRow } from "@/lib/supabase/database.types";

export interface ApplicationListItem extends ApplicationRow {
  document_status: "PENDING" | "PROCESSING" | "COMPLETE" | "FAILED" | null;
}

export function isApplicationStatus(value: string | undefined): value is ApplicationStatus {
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
  }

  return data.map((application) => ({
    ...application,
    document_status: documentStatus.get(application.id) ?? null,
  }));
}

export async function getApplicationDetail(id: string): Promise<{
  application: ApplicationRow;
  documents: Array<DocumentRow & { signed_url: string | null }>;
  events: ApplicationEventRow[];
}> {
  const { supabase, viewer } = await requireViewer();
  const { data: application, error } = await supabase
    .from("applications")
    .select("*")
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
    .select("*")
    .eq("application_id", id)
    .eq("user_id", viewer.id)
    .order("event_time", { ascending: false });

  if (eventsError) {
    throw new Error(`Unable to load the timeline: ${eventsError.message}`);
  }

  const { data: documentRows, error: documentsError } = await supabase
    .from("documents")
    .select("*")
    .eq("application_id", id)
    .eq("user_id", viewer.id)
    .order("created_at", { ascending: false });

  if (documentsError) {
    throw new Error(`Unable to load job descriptions: ${documentsError.message}`);
  }

  const documents = await Promise.all(documentRows.map(async (document) => {
    if (document.capture_status !== "COMPLETE") return { ...document, signed_url: null };
    const { data: signed, error: signedUrlError } = await supabase.storage
      .from("job-descriptions")
      .createSignedUrl(document.storage_path, 300);
    if (signedUrlError) {
      console.error(`Unable to sign document ${document.id}: ${signedUrlError.message}`);
    }
    return { ...document, signed_url: signed?.signedUrl ?? null };
  }));

  return { application, documents, events };
}
