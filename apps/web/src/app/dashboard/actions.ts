"use server";

import { applicationStatusSchema, createApplicationSchema } from "@manager/validation";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/auth";

export interface ApplicationActionState {
  errors?: Record<string, string[]>;
  message?: string;
  success?: boolean;
}

const emptyState: ApplicationActionState = {};

function optionalString(value: FormDataEntryValue | null) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

function optionalDateTime(value: FormDataEntryValue | null) {
  const normalized = optionalString(value);
  if (!normalized) return null;

  const date = new Date(normalized);
  return Number.isNaN(date.valueOf()) ? normalized : date.toISOString();
}

function parseApplicationForm(formData: FormData) {
  return createApplicationSchema.safeParse({
    appliedAt: optionalDateTime(formData.get("appliedAt")),
    company: formData.get("company"),
    jobId: optionalString(formData.get("jobId")),
    originalUrl: optionalString(formData.get("originalUrl")),
    position: formData.get("position"),
    source: "MANUAL",
  });
}

export async function createApplicationAction(
  _previousState: ApplicationActionState = emptyState,
  formData: FormData,
): Promise<ApplicationActionState> {
  void _previousState;
  const parsed = parseApplicationForm(formData);
  const status = applicationStatusSchema.safeParse(formData.get("status"));

  if (!parsed.success || !status.success) {
    return {
      errors: {
        ...(parsed.success ? {} : parsed.error.flatten().fieldErrors),
        ...(status.success ? {} : { status: ["Choose a valid status"] }),
      },
    };
  }

  const { supabase, viewer } = await requireViewer();
  const appliedAt =
    parsed.data.appliedAt ?? (status.data === "SAVED" ? null : new Date().toISOString());
  const { data: application, error } = await supabase
    .from("applications")
    .insert({
      applied_at: appliedAt,
      company: parsed.data.company,
      position: parsed.data.position,
      source: "MANUAL",
      status: status.data,
      user_id: viewer.id,
      ...(parsed.data.jobId !== undefined ? { job_id: parsed.data.jobId } : {}),
      ...(parsed.data.originalUrl !== undefined ? { original_url: parsed.data.originalUrl } : {}),
    })
    .select("id")
    .single();

  if (error || !application) {
    return { message: error?.message ?? "Unable to create the application." };
  }

  const { error: eventError } = await supabase.from("application_events").insert({
    application_id: application.id,
    event_time: new Date().toISOString(),
    event_type: "GENERAL_UPDATE",
    evidence: "Application created manually",
    new_status: status.data,
    source: "MANUAL",
    user_id: viewer.id,
  });

  if (eventError) {
    await supabase.from("applications").delete().eq("id", application.id).eq("user_id", viewer.id);
    return { message: `Unable to create the initial timeline event: ${eventError.message}` };
  }

  revalidatePath("/dashboard");
  redirect(`/dashboard/applications/${application.id}`);
}

export async function updateApplicationAction(
  applicationId: string,
  _previousState: ApplicationActionState,
  formData: FormData,
): Promise<ApplicationActionState> {
  const parsed = parseApplicationForm(formData);
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const { supabase, viewer } = await requireViewer();
  const { data: application, error: ownershipError } = await supabase
    .from("applications")
    .select("id,status")
    .eq("id", applicationId)
    .eq("user_id", viewer.id)
    .maybeSingle();

  if (ownershipError || !application) {
    return { message: "Application not found or you do not have access." };
  }

  const { error } = await supabase
    .from("applications")
    .update({
      applied_at: parsed.data.appliedAt ?? null,
      company: parsed.data.company,
      job_id: parsed.data.jobId ?? null,
      original_url: parsed.data.originalUrl ?? null,
      position: parsed.data.position,
    })
    .eq("id", applicationId)
    .eq("user_id", viewer.id);

  if (error) {
    return { message: error.message };
  }

  const { error: eventError } = await supabase.from("application_events").insert({
    application_id: applicationId,
    event_time: new Date().toISOString(),
    event_type: "GENERAL_UPDATE",
    evidence: "Application details edited manually",
    new_status: application.status,
    previous_status: application.status,
    source: "MANUAL",
    user_id: viewer.id,
  });

  if (eventError) {
    return { message: `Details saved, but the timeline could not be updated: ${eventError.message}` };
  }

  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/applications/${applicationId}`);
  return { message: "Application details saved.", success: true };
}

export async function changeStatusAction(
  applicationId: string,
  _previousState: ApplicationActionState,
  formData: FormData,
): Promise<ApplicationActionState> {
  const status = applicationStatusSchema.safeParse(formData.get("status"));
  if (!status.success) {
    return { errors: { status: ["Choose a valid status"] } };
  }

  const { supabase, viewer } = await requireViewer();
  const { data: application, error: ownershipError } = await supabase
    .from("applications")
    .select("id,status,applied_at")
    .eq("id", applicationId)
    .eq("user_id", viewer.id)
    .maybeSingle();

  if (ownershipError || !application) {
    return { message: "Application not found or you do not have access." };
  }

  if (application.status === status.data) {
    return { message: "That status is already current.", success: true };
  }

  const { error } = await supabase
    .from("applications")
    .update({
      applied_at:
        application.applied_at ?? (status.data === "SAVED" ? null : new Date().toISOString()),
      status: status.data,
    })
    .eq("id", applicationId)
    .eq("user_id", viewer.id);

  if (error) {
    return { message: error.message };
  }

  const { error: eventError } = await supabase.from("application_events").insert({
    application_id: applicationId,
    event_time: new Date().toISOString(),
    event_type: "MANUAL_CORRECTION",
    evidence: `Status changed manually from ${application.status} to ${status.data}`,
    new_status: status.data,
    previous_status: application.status,
    source: "MANUAL",
    user_id: viewer.id,
  });

  if (eventError) {
    return { message: `Status saved, but the timeline could not be updated: ${eventError.message}` };
  }

  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/applications/${applicationId}`);
  return { message: "Status updated.", success: true };
}

export async function deleteApplicationAction(applicationId: string, _formData: FormData) {
  void _formData;
  const { supabase, viewer } = await requireViewer();
  const { data: documents, error: documentsError } = await supabase
    .from("documents")
    .select("storage_path,temporary_storage_path")
    .eq("application_id", applicationId)
    .eq("user_id", viewer.id);

  if (documentsError) {
    throw new Error(`Unable to inspect stored documents: ${documentsError.message}`);
  }

  const pdfPaths = documents.map((document) => document.storage_path);
  const temporaryPaths = documents.flatMap((document) =>
    document.temporary_storage_path ? [document.temporary_storage_path] : [],
  );

  if (temporaryPaths.length > 0) {
    const { error: temporaryError } = await supabase.storage
      .from("temporary-captures")
      .remove(temporaryPaths);
    if (temporaryError) {
      throw new Error(`Unable to delete temporary captures: ${temporaryError.message}`);
    }
  }

  if (pdfPaths.length > 0) {
    const { error: pdfError } = await supabase.storage
      .from("job-descriptions")
      .remove(pdfPaths);
    if (pdfError) {
      throw new Error(`Unable to delete stored PDFs: ${pdfError.message}`);
    }
  }

  const { error } = await supabase
    .from("applications")
    .delete()
    .eq("id", applicationId)
    .eq("user_id", viewer.id);

  if (error) {
    throw new Error(`Unable to delete the application: ${error.message}`);
  }

  revalidatePath("/dashboard");
  redirect("/dashboard");
}

export async function retryCaptureAction(
  applicationId: string,
  documentId: string,
  _previousState: ApplicationActionState,
  _formData: FormData,
): Promise<ApplicationActionState> {
  void _previousState;
  void _formData;
  const { supabase } = await requireViewer();
  const { data, error } = await supabase.rpc("retry_failed_capture", {
    p_document_id: documentId,
  });

  if (error) {
    return { message: `Unable to retry the capture: ${error.message}` };
  }
  if (!data) {
    return {
      message: "The temporary capture is no longer available. Open the original job page and capture it again.",
    };
  }

  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/applications/${applicationId}`);
  return { message: "Retry queued.", success: true };
}
