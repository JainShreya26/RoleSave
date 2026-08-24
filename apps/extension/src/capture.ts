import { supabase } from "./supabase";

export interface PageMetadata {
  company: string;
  position: string;
  url: string;
  title: string;
}

export interface PendingApplication {
  applicationId: string;
  company: string;
  position: string;
  savedAt: string;
}

const pendingApplicationKey = "ledger.pendingApplication";
const pendingApplicationLifetime = 7 * 24 * 60 * 60 * 1_000;

interface CaptureSession {
  application_id: string;
  capture_status: "PENDING" | "PROCESSING" | "COMPLETE" | "FAILED";
  document_id: string;
  job_id: string;
  temporary_storage_path: string;
}

function getActiveTab() {
  return chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    if (!tab?.id || !tab.url) throw new Error("Open a job posting in the active tab first.");
    if (!/^https?:\/\//.test(tab.url)) throw new Error("This page cannot be captured. Open an HTTP or HTTPS job posting.");
    return tab as chrome.tabs.Tab & { id: number; url: string };
  });
}

export async function readPageMetadata(): Promise<PageMetadata> {
  const tab = await getActiveTab();
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const candidates: Record<string, unknown>[] = [];
      for (const script of document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]')) {
        try {
          const value: unknown = JSON.parse(script.textContent || "null");
          const visit = (node: unknown) => {
            if (!node || typeof node !== "object") return;
            if (Array.isArray(node)) return node.forEach(visit);
            const record = node as Record<string, unknown>;
            const types = Array.isArray(record["@type"]) ? record["@type"] : [record["@type"]];
            if (types.includes("JobPosting")) candidates.push(record);
            if (Array.isArray(record["@graph"])) record["@graph"].forEach(visit);
          };
          visit(value);
        } catch {
          // Invalid JSON-LD should not prevent fallback detection.
        }
      }

      const job = candidates[0];
      const organization = job?.hiringOrganization;
      const cleanText = (value: string | null | undefined) => value?.replace(/\s+/g, " ").trim() || "";
      const parseGreenhouseTitle = (value: string) => {
        const normalized = cleanText(value).replace(/^Job Application for\s+/i, "");
        if (normalized === cleanText(value)) return null;
        const separator = normalized.lastIndexOf(" at ");
        if (separator < 1) return null;
        const position = cleanText(normalized.slice(0, separator));
        const company = cleanText(normalized.slice(separator + 4)).replace(/\s+[|–—-]\s+Greenhouse.*$/i, "");
        return position && company ? { company, position } : null;
      };
      const socialTitle = document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content;
      const greenhouseTitle = parseGreenhouseTitle(document.title) || parseGreenhouseTitle(socialTitle || "");
      const explicitCompany = cleanText(
        document.querySelector<HTMLElement>(
          '[data-testid="company-name"], .company-name, .job__company, .job-company, [class*="company-name"]',
        )?.innerText,
      ).replace(/^at\s+/i, "");
      const siteName = cleanText(document.querySelector<HTMLMetaElement>('meta[property="og:site_name"]')?.content);
      const company =
        organization && typeof organization === "object" && typeof (organization as Record<string, unknown>).name === "string"
          ? String((organization as Record<string, unknown>).name)
          : greenhouseTitle?.company ||
            explicitCompany ||
            cleanText(document.querySelector<HTMLElement>('[data-company], [class*="company"]')?.innerText) ||
            (!/^greenhouse$/i.test(siteName) ? siteName : "") ||
            location.hostname.replace(/^www\./, "");
      const position =
        (typeof job?.title === "string" ? job.title : "") ||
        greenhouseTitle?.position ||
        document.querySelector("h1")?.textContent?.trim() ||
        document.title.split(/\s+[|–—]\s+|\s+-\s+/)[0]?.trim() ||
        "Job posting";

      return { company, position, title: document.title };
    },
  });

  if (!result?.result) throw new Error("Could not read job metadata from this page.");
  return { ...result.result, url: tab.url };
}

function saveAsMhtml(tabId: number) {
  return new Promise<Blob>((resolve, reject) => {
    chrome.pageCapture.saveAsMHTML({ tabId }, (data) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else if (!data) reject(new Error("Chrome did not return a page archive."));
      else resolve(data);
    });
  });
}

export async function captureJob(metadata: PageMetadata, idempotencyKey: string): Promise<string> {
  const tab = await getActiveTab();
  const { data, error } = await supabase.rpc("create_capture_session", {
    p_captured_at: new Date().toISOString(),
    p_company: metadata.company,
    p_idempotency_key: idempotencyKey,
    p_original_url: metadata.url,
    p_position: metadata.position,
  });

  if (error) throw error;
  const session = (data as CaptureSession[] | null)?.[0];
  if (!session) throw new Error("The capture session could not be created.");

  try {
    const prepared = await supabase.rpc("retry_capture_upload", { p_job_id: session.job_id });
    if (prepared.error) throw prepared.error;
    if (!prepared.data) return session.application_id;

    if (session.capture_status === "FAILED") {
      const removal = await supabase.storage.from("temporary-captures").remove([session.temporary_storage_path]);
      if (removal.error) throw removal.error;
    }

    const archive = await saveAsMhtml(tab.id);
    const upload = await supabase.storage.from("temporary-captures").upload(session.temporary_storage_path, archive, {
      cacheControl: "3600",
      contentType: "multipart/related",
      upsert: false,
    });
    if (upload.error) throw upload.error;

    const finalized = await supabase.rpc("finalize_capture_upload", { p_job_id: session.job_id });
    if (finalized.error) throw finalized.error;
    if (!finalized.data) throw new Error("The uploaded capture could not be queued.");
  } catch (error) {
    await supabase.rpc("fail_capture_upload", {
      p_error: error instanceof Error ? error.message : "Capture upload failed",
      p_job_id: session.job_id,
    });
    throw error;
  }

  return session.application_id;
}

export async function markApplicationApplied(applicationId: string) {
  const { data, error } = await supabase.rpc("mark_application_applied", {
    p_application_id: applicationId,
  });
  if (error) throw error;
  if (!data) {
    throw new Error("This application is already in a later stage and was not changed.");
  }
}

export async function rememberPendingApplication(
  applicationId: string,
  metadata: PageMetadata,
): Promise<PendingApplication> {
  const pending = {
    applicationId,
    company: metadata.company,
    position: metadata.position,
    savedAt: new Date().toISOString(),
  };
  await chrome.storage.local.set({ [pendingApplicationKey]: pending });
  return pending;
}

export async function readPendingApplication(): Promise<PendingApplication | null> {
  const stored = (await chrome.storage.local.get(pendingApplicationKey))[pendingApplicationKey] as unknown;
  if (!stored || typeof stored !== "object") return null;
  const pending = stored as Partial<PendingApplication>;
  if (
    typeof pending.applicationId !== "string" ||
    typeof pending.company !== "string" ||
    typeof pending.position !== "string" ||
    typeof pending.savedAt !== "string"
  ) {
    await chrome.storage.local.remove(pendingApplicationKey);
    return null;
  }

  const savedAt = new Date(pending.savedAt).valueOf();
  if (!Number.isFinite(savedAt) || Date.now() - savedAt > pendingApplicationLifetime) {
    await chrome.storage.local.remove(pendingApplicationKey);
    return null;
  }
  return pending as PendingApplication;
}

export async function clearPendingApplication() {
  await chrome.storage.local.remove(pendingApplicationKey);
}
