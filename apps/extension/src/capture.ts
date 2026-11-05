import type { SupabaseClient } from "@supabase/supabase-js";
import { detectJobPage, type DetectedPage } from "./detect.ts";

export interface PageMetadata extends DetectedPage {
  tabId: number;
  url: string;
}

interface CaptureSession {
  application_company?: string;
  application_id: string;
  application_position?: string;
  application_reused: boolean;
  capture_status: "PENDING" | "PROCESSING" | "COMPLETE" | "FAILED";
  document_id: string;
  job_id: string;
  temporary_storage_path: string;
}

export interface CaptureRequest {
  company: string;
  jobId: string | null;
  position: string;
  tabId: number;
  url: string;
}

export interface CaptureResult {
  applicationId: string;
  /** The saved record's name, which differs from the page if the application was reused. */
  company: string;
  position: string;
  reused: boolean;
}

export interface CaptureDependencies {
  client: Pick<SupabaseClient, "rpc" | "storage">;
  saveAsMhtml(tabId: number): Promise<Blob>;
}

export type MarkAppliedOutcome = "applied" | "later-stage" | "missing";

function getActiveTab() {
  return chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    if (!tab?.id || !tab.url) throw new Error("Open a job posting in the active tab first.");
    if (!/^https?:\/\//.test(tab.url)) throw new Error("This page cannot be captured. Open an HTTP or HTTPS job posting.");
    return tab as chrome.tabs.Tab & { id: number; url: string };
  });
}

export async function readPageMetadata(): Promise<PageMetadata> {
  const tab = await getActiveTab();
  let detected: DetectedPage | undefined;
  try {
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: detectJobPage });
    detected = result?.result;
  } catch {
    // Chrome refuses some pages, such as its web store and the PDF viewer.
  }
  if (!detected) throw new Error("RoleSave can't read this page. Open the job posting in a regular browser tab.");
  return { ...detected, tabId: tab.id, url: tab.url };
}

export function saveTabAsMhtml(tabId: number) {
  return new Promise<Blob>((resolve, reject) => {
    chrome.pageCapture.saveAsMHTML({ tabId }, (data) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else if (!data) reject(new Error("Chrome did not return a page archive."));
      else resolve(data);
    });
  });
}

export async function captureJob(
  request: CaptureRequest,
  idempotencyKey: string,
  { client, saveAsMhtml }: CaptureDependencies,
): Promise<CaptureResult> {
  // Capture first, because someone clicking Save may leave the page right after.
  const archive = await saveAsMhtml(request.tabId);

  const { data, error } = await client.rpc("create_capture_session", {
    p_captured_at: new Date().toISOString(),
    p_company: request.company,
    p_idempotency_key: idempotencyKey,
    p_job_id: request.jobId,
    p_original_url: request.url,
    p_position: request.position,
  });

  if (error) throw error;
  const session = (data as CaptureSession[] | null)?.[0];
  if (!session) throw new Error("The capture session could not be created.");

  const result: CaptureResult = {
    applicationId: session.application_id,
    company: session.application_company ?? request.company,
    position: session.application_position ?? request.position,
    reused: session.application_reused,
  };

  try {
    const prepared = await client.rpc("retry_capture_upload", { p_job_id: session.job_id });
    if (prepared.error) throw prepared.error;
    if (!prepared.data) return result;

    // An earlier attempt may have left a file, even if its response was lost,
    // and the bucket refuses to overwrite one.
    const removal = await client.storage.from("temporary-captures").remove([session.temporary_storage_path]);
    if (removal.error) throw removal.error;

    const upload = await client.storage.from("temporary-captures").upload(session.temporary_storage_path, archive, {
      cacheControl: "3600",
      contentType: "multipart/related",
      upsert: false,
    });
    if (upload.error) throw upload.error;

    const finalized = await client.rpc("finalize_capture_upload", { p_job_id: session.job_id });
    if (finalized.error) throw finalized.error;
    if (!finalized.data) throw new Error("The uploaded capture could not be queued.");
  } catch (error) {
    await client.rpc("fail_capture_upload", {
      p_error: error instanceof Error ? error.message : "Capture upload failed",
      p_job_id: session.job_id,
    });
    throw error;
  }

  return result;
}

export async function markApplicationApplied(
  applicationId: string,
  client: Pick<SupabaseClient, "rpc" | "from">,
): Promise<MarkAppliedOutcome> {
  const { data, error } = await client.rpc("mark_application_applied", {
    p_application_id: applicationId,
  });
  if (error) throw error;
  if (data) return "applied";

  const existing = await client.from("applications").select("id").eq("id", applicationId).maybeSingle();
  if (existing.error) throw existing.error;
  return existing.data ? "later-stage" : "missing";
}
