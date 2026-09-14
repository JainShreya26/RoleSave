import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import {
  captureJobSchema,
  captureQueueJobSchema,
  type CaptureJobInput,
  type CaptureQueueJobInput,
} from "@rolesave/validation";
import { classifyEmail } from "./email/classify";
import {
  decideEmailMatch,
  hasTrackedApplicationEvidence,
  type EmailMatchCandidate,
} from "./email/match";
import { buildEmailSignals } from "./email/signals";
import { parseRawEmail } from "./email/parse";
import { pollResendInbox } from "./email/resend-poll";
import type { ClassifiedEmail, ParsedEmail } from "./email/types";

const executeFile = promisify(execFile);
const converterScript = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../spikes/mhtml-capture/scripts/convert.mjs",
);
const defaultConverterImage = "rolesave-mhtml-converter:local";

interface ConverterInvocation {
  command: string;
  args: string[];
}

export function createConverterInvocation(
  temporaryDirectory: string,
  runtime = process.env.MHTML_CONVERTER_RUNTIME ?? "container",
): ConverterInvocation {
  if (runtime === "local") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Local MHTML conversion is disabled in production.");
    }
    return {
      command: process.execPath,
      args: [
        converterScript,
        "--input", path.join(temporaryDirectory, "capture.mhtml"),
        "--output", path.join(temporaryDirectory, "job-description.pdf"),
        "--metadata", path.join(temporaryDirectory, "metadata.json"),
      ],
    };
  }

  if (runtime !== "container") {
    throw new Error(`Unsupported MHTML_CONVERTER_RUNTIME: ${runtime}`);
  }

  const engine = process.env.MHTML_CONTAINER_ENGINE ?? "docker";
  if (engine !== "docker" && engine !== "podman") {
    throw new Error("MHTML_CONTAINER_ENGINE must be docker or podman.");
  }
  const user = typeof process.getuid === "function" && typeof process.getgid === "function"
    ? `${process.getuid()}:${process.getgid()}`
    : "1000:1000";

  return {
    command: engine,
    args: [
      "run",
      "--rm",
      "--network=none",
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      "--pids-limit=128",
      "--memory=768m",
      "--cpus=1",
      "--shm-size=256m",
      "--tmpfs=/tmp:rw,nosuid,nodev,noexec,size=128m",
      `--user=${user}`,
      "--env=HOME=/tmp",
      `--volume=${temporaryDirectory}:/work:rw`,
      process.env.MHTML_CONVERTER_IMAGE ?? defaultConverterImage,
      "--input", "/work/capture.mhtml",
      "--output", "/work/job-description.pdf",
      "--metadata", "/work/metadata.json",
    ],
  };
}

export interface CaptureResult { fileSizeBytes: number; checksumSha256: string; }
export interface CaptureWorkerDependencies {
  setStatus(documentId: string, status: "PROCESSING" | "COMPLETE" | "FAILED"): Promise<void>;
  convert(job: CaptureJobInput): Promise<CaptureResult>;
}

export async function processCaptureJob(input: unknown, dependencies: CaptureWorkerDependencies) {
  const job = captureJobSchema.parse(input);
  await dependencies.setStatus(job.documentId, "PROCESSING");
  try {
    const result = await dependencies.convert(job);
    await dependencies.setStatus(job.documentId, "COMPLETE");
    return result;
  } catch (error) {
    await dependencies.setStatus(job.documentId, "FAILED");
    throw error;
  }
}

interface ClaimedJobRow {
  application_id: string;
  captured_at: string;
  company: string;
  document_id: string;
  job_id: string;
  original_url: string;
  output_storage_path: string;
  job_position: string;
  temporary_storage_path: string;
  user_id: string;
}

interface ClaimedEmailJobRow {
  email_account_id: string;
  job_id: string;
  provider_message_id: string;
  storage_path: string;
  user_id: string;
}

interface EmailEventIdentityRow { id: string; }

interface StoredPayloadRow {
  id: string;
  storage_path?: string;
  temporary_storage_path?: string;
}

interface FailedCaptureRow {
  document_id: string;
  id: string;
}

function retentionDays(name: string, fallback: number, minimum: number) {
  const configured = Number(process.env[name]);
  return Number.isInteger(configured) && configured >= minimum ? configured : fallback;
}

async function clearTemporaryCapture(
  client: SupabaseClient,
  documentId: string,
  storagePath: string,
) {
  const cleanup = await client.storage.from("temporary-captures").remove([storagePath]);
  if (cleanup.error) return { error: cleanup.error, removed: false };

  const cleared = await client
    .from("documents")
    .update({ temporary_storage_path: null })
    .eq("id", documentId)
    .eq("temporary_storage_path", storagePath);
  return { error: cleared.error, removed: !cleared.error };
}

async function clearRawEmail(
  client: SupabaseClient,
  jobId: string,
  storagePath: string,
) {
  const cleanup = await client.storage.from("inbound-emails").remove([storagePath]);
  if (cleanup.error) return { error: cleanup.error, removed: false };

  const cleared = await client
    .from("inbound_email_jobs")
    .update({ storage_deleted_at: new Date().toISOString() })
    .eq("id", jobId)
    .is("storage_deleted_at", null);
  return { error: cleared.error, removed: !cleared.error };
}

export async function cleanupStoredPayloads(client: SupabaseClient) {
  const [documentResult, emailResult] = await Promise.all([
    client
      .from("documents")
      .select("id,temporary_storage_path")
      .eq("capture_status", "COMPLETE")
      .not("temporary_storage_path", "is", null)
      .limit(20),
    client
      .from("inbound_email_jobs")
      .select("id,storage_path")
      .eq("status", "COMPLETE")
      .is("storage_deleted_at", null)
      .limit(20),
  ]);
  if (documentResult.error) throw documentResult.error;
  if (emailResult.error) throw emailResult.error;

  let cleaned = 0;
  for (const row of documentResult.data as StoredPayloadRow[]) {
    if (!row.temporary_storage_path) continue;
    const result = await clearTemporaryCapture(client, row.id, row.temporary_storage_path);
    if (result.error) {
      console.warn(`Temporary capture cleanup retry failed: ${result.error.message}`);
    } else {
      cleaned += 1;
    }
  }
  for (const row of emailResult.data as StoredPayloadRow[]) {
    if (!row.storage_path) continue;
    const result = await clearRawEmail(client, row.id, row.storage_path);
    if (result.error) {
      console.warn(`Raw email cleanup retry failed: ${result.error.message}`);
    } else {
      cleaned += 1;
    }
  }
  return cleaned;
}

export async function enforceOperationalRetention(client: SupabaseClient, now = new Date()) {
  const payloadRetentionDays = retentionDays("FAILED_PAYLOAD_RETENTION_DAYS", 7, 1);
  const metadataRetentionDays = retentionDays("FAILED_JOB_RETENTION_DAYS", 90, 30);
  const payloadCutoff = new Date(now.getTime() - payloadRetentionDays * 86_400_000).toISOString();

  const [captureResult, emailResult] = await Promise.all([
    client
      .from("capture_jobs")
      .select("id,document_id")
      .eq("status", "FAILED")
      .lt("failed_at", payloadCutoff)
      .limit(20),
    client
      .from("inbound_email_jobs")
      .select("id,storage_path")
      .eq("status", "FAILED")
      .is("storage_deleted_at", null)
      .lt("failed_at", payloadCutoff)
      .limit(20),
  ]);
  if (captureResult.error) throw captureResult.error;
  if (emailResult.error) throw emailResult.error;

  const captures = captureResult.data as FailedCaptureRow[];
  const documentIds = captures.map((job) => job.document_id);
  const documentsResult = documentIds.length === 0
    ? { data: [], error: null }
    : await client
        .from("documents")
        .select("id,temporary_storage_path")
        .in("id", documentIds)
        .not("temporary_storage_path", "is", null);
  if (documentsResult.error) throw documentsResult.error;

  let payloadsDeleted = 0;
  for (const document of documentsResult.data as StoredPayloadRow[]) {
    if (!document.temporary_storage_path) continue;
    const result = await clearTemporaryCapture(client, document.id, document.temporary_storage_path);
    if (result.error) {
      console.warn(`Expired failed capture cleanup failed: ${result.error.message}`);
    } else {
      payloadsDeleted += 1;
    }
  }
  for (const email of emailResult.data as StoredPayloadRow[]) {
    if (!email.storage_path) continue;
    const result = await clearRawEmail(client, email.id, email.storage_path);
    if (result.error) {
      console.warn(`Expired failed email cleanup failed: ${result.error.message}`);
    } else {
      payloadsDeleted += 1;
    }
  }

  const purge = await client.rpc("purge_expired_operational_data", {
    p_failed_metadata_retention_days: metadataRetentionDays,
  });
  if (purge.error) throw purge.error;
  const counts = purge.data?.[0];
  return {
    metadataRowsDeleted: (counts?.capture_jobs_deleted ?? 0) + (counts?.email_jobs_deleted ?? 0),
    payloadsDeleted,
  };
}

interface CandidateRow {
  application_id: string;
  company: string;
  company_conflict: boolean;
  company_exact: boolean;
  company_similarity: number;
  days_apart: number;
  job_position: string;
  matched_job_id: boolean;
  matched_tenant: boolean;
  matched_thread: boolean;
  matched_tokens: string[] | null;
}

/**
 * Narrows the message to the applications it could plausibly concern. Runs
 * before the classification is persisted, because whether a message is job
 * related depends partly on whether it refers to something already tracked.
 */
async function retrieveCandidates(
  job: ClaimedEmailJobRow,
  parsed: ParsedEmail,
  client: SupabaseClient,
): Promise<EmailMatchCandidate[]> {
  let previousThreadApplicationId: string | null = null;
  if (parsed.threadId) {
    const previous = await client
      .from("email_events")
      .select("application_id")
      .eq("user_id", job.user_id)
      .eq("thread_id", parsed.threadId)
      .not("application_id", "is", null)
      .order("received_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (previous.error) throw previous.error;
    previousThreadApplicationId = (previous.data as { application_id: string | null } | null)?.application_id ?? null;
  }

  const signals = buildEmailSignals(parsed);
  const result = await client.rpc("match_email_candidates", {
    p_company_mentions: signals.companyMentions,
    p_job_id_mentions: signals.jobIdMentions,
    p_link_urls: signals.linkUrls,
    p_received_at: parsed.receivedAt,
    p_thread_application_id: previousThreadApplicationId,
    p_tokens: signals.tokens,
    p_user_id: job.user_id,
  });
  if (result.error) throw result.error;

  return ((result.data ?? []) as CandidateRow[]).map((row) => ({
    applicationId: row.application_id,
    company: row.company,
    companyConflict: row.company_conflict,
    companyExact: row.company_exact,
    companySimilarity: row.company_similarity,
    daysApart: row.days_apart,
    matchedJobId: row.matched_job_id,
    matchedTenant: row.matched_tenant,
    matchedThread: row.matched_thread,
    matchedTokens: row.matched_tokens ?? [],
    position: row.job_position,
  }));
}

/**
 * The metadata pre-filter scores a message on who sent it and what the subject
 * says, which a hiring manager writing a plain sentence from their own address
 * fails completely. A message that demonstrably refers to a tracked
 * application is job related whatever that score says, so it is reclassified
 * as an unrecognized event and sent to review rather than discarded.
 *
 * Bulk mail is exempt: a job-alert digest naming an employer you applied to is
 * still a digest, and its unsubscribe header says so.
 */
export function reconsiderClassification(
  classified: ClassifiedEmail,
  parsed: ParsedEmail,
  candidates: EmailMatchCandidate[],
): ClassifiedEmail {
  if (classified.classification !== "NOT_JOB_RELATED") return classified;
  if (parsed.hasUnsubscribe) return classified;
  if (!hasTrackedApplicationEvidence(candidates)) return classified;

  return {
    ...classified,
    classification: "UNKNOWN_EMAIL_EVENT",
    confidence: 0.5,
    evidence: `Metadata score ${parsed.metadataScore} suggested this was not job related, `
      + "but the message refers to a tracked application.",
  };
}

/**
 * Surfaces an email whose matching could not complete. Review tasks are opened
 * on demand rather than by an insert trigger, so this is what keeps a failure
 * visible: the message reaches Needs Review with no suggestion attached and
 * waits for a person.
 */
async function openReviewForUnmatchedEmail(
  client: SupabaseClient,
  emailJobId: string,
  failure: string,
) {
  const eventResult = await client
    .from("email_events")
    .select("id")
    .eq("email_job_id", emailJobId)
    .maybeSingle();
  if (eventResult.error) throw eventResult.error;
  if (!eventResult.data) return;

  const opened = await client.rpc("set_email_review_suggestions", {
    p_email_event_id: (eventResult.data as EmailEventIdentityRow).id,
    p_match_confidence: null,
    p_reason: `Automatic matching did not finish: ${failure}`.slice(0, 1_000),
    p_suggested_application_ids: [],
  });
  if (opened.error) throw opened.error;
}

// A recognized message is represented by what RoleSave concluded about it, not
// by a copy of its text. An ignored message is the one case where the
// conclusion is not enough: the classifier decided it was not job related, and
// only the person can tell whether that was wrong, so Needs Review shows them a
// bounded preview to judge and rescue it.
const ignoredBodyPreviewCharacters = 1_000;

async function matchEmailEvent(
  job: ClaimedEmailJobRow,
  parsed: ParsedEmail,
  classified: ClassifiedEmail,
  candidates: EmailMatchCandidate[],
  client: SupabaseClient,
) {
  const eventResult = await client
    .from("email_events")
    .select("id")
    .eq("email_job_id", job.job_id)
    .single();
  if (eventResult.error) throw eventResult.error;
  const emailEvent = eventResult.data as EmailEventIdentityRow;

  const ignored = classified.classification === "NOT_JOB_RELATED";
  const entityUpdate = await client
    .from("email_events")
    .update({
      body_preview: ignored
        ? parsed.bodyText.slice(0, ignoredBodyPreviewCharacters) || null
        : null,
      extracted_company: classified.extractedCompany,
      extracted_position: classified.extractedPosition,
    })
    .eq("id", emailEvent.id);
  if (entityUpdate.error) throw entityUpdate.error;

  if (ignored) return;

  const decision = decideEmailMatch(candidates);

  if (decision.automaticApplicationId && classified.classification !== "UNKNOWN_EMAIL_EVENT") {
    const automatic = await client.rpc("apply_automatic_email_match", {
      p_application_id: decision.automaticApplicationId,
      p_email_event_id: emailEvent.id,
      p_match_confidence: decision.confidence,
    });
    if (automatic.error) throw automatic.error;
    if (!automatic.data) throw new Error(`Email event ${emailEvent.id} could not be matched.`);
    return;
  }

  const suggestions = await client.rpc("set_email_review_suggestions", {
    p_email_event_id: emailEvent.id,
    p_match_confidence: decision.confidence,
    p_reason: decision.reason,
    p_suggested_application_ids: decision.suggestedApplicationIds,
  });
  if (suggestions.error) throw suggestions.error;
  if (!suggestions.data) throw new Error(`Review suggestions for email event ${emailEvent.id} could not be saved.`);
}

function toQueueJob(row: ClaimedJobRow): CaptureQueueJobInput {
  return captureQueueJobSchema.parse({
    applicationId: row.application_id,
    capturedAt: row.captured_at,
    company: row.company,
    documentId: row.document_id,
    jobId: row.job_id,
    originalUrl: row.original_url,
    outputStoragePath: row.output_storage_path,
    position: row.job_position,
    temporaryStoragePath: row.temporary_storage_path,
    userId: row.user_id,
  });
}

async function convertAndUpload(job: CaptureQueueJobInput, client: SupabaseClient): Promise<CaptureResult> {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rolesave-worker-"));
  const inputPath = path.join(temporaryDirectory, "capture.mhtml");
  const outputPath = path.join(temporaryDirectory, "job-description.pdf");
  const metadataPath = path.join(temporaryDirectory, "metadata.json");

  try {
    const download = await client.storage.from("temporary-captures").download(job.temporaryStoragePath);
    if (download.error) throw download.error;
    await fs.writeFile(inputPath, Buffer.from(await download.data.arrayBuffer()));
    await fs.writeFile(metadataPath, JSON.stringify({
      capturedAt: job.capturedAt,
      company: job.company,
      originalUrl: job.originalUrl,
      position: job.position,
    }), { mode: 0o600 });

    const invocation = createConverterInvocation(temporaryDirectory);
    await executeFile(invocation.command, invocation.args, {
      killSignal: "SIGKILL",
      maxBuffer: 1024 * 1024,
      timeout: 120_000,
    });

    const pdf = await fs.readFile(outputPath);
    const upload = await client.storage.from("job-descriptions").upload(job.outputStoragePath, pdf, {
      cacheControl: "3600",
      contentType: "application/pdf",
      upsert: true,
    });
    if (upload.error) throw upload.error;

    return {
      checksumSha256: createHash("sha256").update(pdf).digest("hex"),
      fileSizeBytes: pdf.byteLength,
    };
  } finally {
    await fs.rm(temporaryDirectory, { force: true, recursive: true });
  }
}

export async function runWorkerOnce(client: SupabaseClient): Promise<boolean> {
  const claim = await client.rpc("claim_capture_job");
  if (claim.error) throw claim.error;
  const row = (claim.data as ClaimedJobRow[] | null)?.[0];
  if (!row) return false;

  const job = toQueueJob(row);
  try {
    const result = await convertAndUpload(job, client);
    const completion = await client.rpc("complete_capture_job", {
      p_checksum_sha256: result.checksumSha256,
      p_file_size_bytes: result.fileSizeBytes,
      p_job_id: job.jobId,
    });
    if (completion.error) throw completion.error;
    if (!completion.data) throw new Error(`Capture job ${job.jobId} could not be completed.`);

    const cleanup = await clearTemporaryCapture(client, job.documentId, job.temporaryStoragePath);
    if (cleanup.error) console.warn(`Temporary capture cleanup failed: ${cleanup.error.message}`);
    console.log(`Completed ${job.company} — ${job.position}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const outputCleanup = await client.storage.from("job-descriptions").remove([job.outputStoragePath]);
    if (outputCleanup.error) console.error(`Could not clean up failed PDF: ${outputCleanup.error.message}`);
    const failure = await client.rpc("fail_capture_job", { p_error: message, p_job_id: job.jobId });
    if (failure.error) console.error(`Could not record capture failure: ${failure.error.message}`);
    throw error;
  }

  return true;
}

export async function runEmailWorkerOnce(client: SupabaseClient): Promise<boolean> {
  const claim = await client.rpc("claim_inbound_email_job");
  if (claim.error) throw claim.error;
  const job = (claim.data as ClaimedEmailJobRow[] | null)?.[0];
  if (!job) return false;

  try {
    const download = await client.storage.from("inbound-emails").download(job.storage_path);
    if (download.error) throw download.error;

    const parsed = await parseRawEmail(Buffer.from(await download.data.arrayBuffer()));

    // Retrieval runs before the classification is stored so that a message
    // referring to a tracked application cannot be dropped by the metadata
    // pre-filter, and so the candidates are fetched exactly once.
    const candidates = await retrieveCandidates(job, parsed, client);
    const classified = reconsiderClassification(classifyEmail(parsed), parsed, candidates);

    const completion = await client.rpc("complete_inbound_email_job", {
      p_classification: classified.classification,
      p_classification_confidence: classified.confidence,
      p_evidence: classified.evidence,
      p_extracted_job_id: classified.extractedJobId,
      p_job_id: job.job_id,
      p_meeting_url: classified.meetingUrl,
      p_message_id: parsed.messageId,
      p_metadata_score: parsed.metadataScore,
      p_received_at: parsed.receivedAt,
      p_sender: parsed.senderAddress,
      p_sender_domain: parsed.senderDomain,
      p_sender_name: parsed.senderName,
      p_subject: parsed.subject,
      p_thread_id: parsed.threadId,
    });
    if (completion.error) throw completion.error;
    if (!completion.data) throw new Error(`Email job ${job.job_id} could not be completed.`);

    await matchEmailEvent(job, parsed, classified, candidates, client).catch(async (error: unknown) => {
      // Matching runs after the event is stored, so a failure here must not
      // leave a classified message with nowhere to appear. Hand it to the
      // person instead of dropping it or holding on to the raw payload.
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Email matching deferred: ${message}`);
      await openReviewForUnmatchedEmail(client, job.job_id, message).catch((followUp: unknown) => {
        console.error(
          `Could not open a review task for the deferred email: ${
            followUp instanceof Error ? followUp.message : String(followUp)
          }`,
        );
      });
    });

    const cleanup = await clearRawEmail(client, job.job_id, job.storage_path);
    if (cleanup.error) console.warn(`Raw email cleanup failed: ${cleanup.error.message}`);
    console.log(`Classified inbound email as ${classified.classification}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failure = await client.rpc("fail_inbound_email_job", {
      p_error: message,
      p_job_id: job.job_id,
    });
    if (failure.error) console.error(`Could not record email failure: ${failure.error.message}`);
    throw error;
  }

  return true;
}

async function startWorker() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serverKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serverKey) {
    throw new Error(
      "Add SUPABASE_SECRET_KEY to apps/web/.env.local before starting the worker.",
    );
  }

  const client = createClient(supabaseUrl, serverKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  console.log("RoleSave capture worker is running.");
  const runOnce = process.argv.includes("--once");
  const resendApiKey = process.env.RESEND_API_KEY?.trim();
  const inboundDomain = process.env.INBOUND_EMAIL_DOMAIN?.trim().toLowerCase();
  const resend = resendApiKey && inboundDomain ? new Resend(resendApiKey) : null;
  const configuredInterval = Number(process.env.RESEND_POLL_INTERVAL_MS);
  const resendPollInterval = Number.isFinite(configuredInterval) && configuredInterval >= 10_000
    ? configuredInterval
    : 30_000;
  let nextResendPollAt = 0;
  let nextCleanupAt = 0;
  let nextRetentionAt = 0;

  while (true) {
    let resendQueued = 0;
    if (resend && inboundDomain && Date.now() >= nextResendPollAt) {
      resendQueued = await pollResendInbox(client, resend, inboundDomain).catch((error: unknown) => {
        console.error(`Resend polling failed: ${error instanceof Error ? error.message : String(error)}`);
        return 0;
      });
      nextResendPollAt = Date.now() + resendPollInterval;
      if (resendQueued > 0) console.log(`Queued ${resendQueued} email${resendQueued === 1 ? "" : "s"} from Resend.`);
    }

    const captureProcessed = await runWorkerOnce(client).catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      return false;
    });
    const emailProcessed = captureProcessed ? false : await runEmailWorkerOnce(client).catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      return false;
    });
    let cleanedPayloads = 0;
    if (Date.now() >= nextCleanupAt) {
      cleanedPayloads = await cleanupStoredPayloads(client).catch((error: unknown) => {
        console.error(`Stored payload cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
        return 0;
      });
      nextCleanupAt = Date.now() + 60_000;
    }
    let retentionWork = 0;
    if (Date.now() >= nextRetentionAt) {
      const retention = await enforceOperationalRetention(client).catch((error: unknown) => {
        console.error(`Operational retention failed: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      });
      retentionWork = retention
        ? retention.metadataRowsDeleted + retention.payloadsDeleted
        : 0;
      nextRetentionAt = Date.now() + 60 * 60_000;
    }
    if (!captureProcessed && !emailProcessed && resendQueued === 0 && cleanedPayloads === 0 && retentionWork === 0) {
      if (runOnce) return;
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startWorker().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
