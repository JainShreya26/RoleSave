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
} from "@manager/validation";
import { classifyEmail } from "./email/classify";
import { decideApplicationMatch, rankApplicationMatches, type MatchableApplication } from "./email/match";
import { parseRawEmail } from "./email/parse";
import { pollResendInbox } from "./email/resend-poll";
import type { ClassifiedEmail, ParsedEmail } from "./email/types";

const executeFile = promisify(execFile);
const converterScript = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../spikes/mhtml-capture/scripts/convert.mjs",
);

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

async function matchEmailEvent(
  job: ClaimedEmailJobRow,
  parsed: ParsedEmail,
  classified: ClassifiedEmail,
  client: SupabaseClient,
) {
  const eventResult = await client
    .from("email_events")
    .select("id")
    .eq("email_job_id", job.job_id)
    .single();
  if (eventResult.error) throw eventResult.error;
  const emailEvent = eventResult.data as EmailEventIdentityRow;

  const entityUpdate = await client
    .from("email_events")
    .update({
      extracted_company: classified.extractedCompany,
      extracted_position: classified.extractedPosition,
    })
    .eq("id", emailEvent.id);
  if (entityUpdate.error) throw entityUpdate.error;

  if (classified.classification === "NOT_JOB_RELATED") return;

  const applicationsResult = await client
    .from("applications")
    .select("id,company,position,job_id,original_domain,applied_at,created_at")
    .eq("user_id", job.user_id);
  if (applicationsResult.error) throw applicationsResult.error;

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

  const applications: MatchableApplication[] = applicationsResult.data.map((application) => ({
    appliedAt: application.applied_at,
    company: application.company,
    createdAt: application.created_at,
    id: application.id,
    jobId: application.job_id,
    originalDomain: application.original_domain,
    position: application.position,
  }));
  const candidates = rankApplicationMatches({
    extractedCompany: classified.extractedCompany,
    extractedJobId: classified.extractedJobId,
    extractedPosition: classified.extractedPosition,
    previousThreadApplicationId,
    receivedAt: parsed.receivedAt,
    senderDomain: parsed.senderDomain,
  }, applications);
  const decision = decideApplicationMatch(candidates);

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
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "manager-worker-"));
  const inputPath = path.join(temporaryDirectory, "capture.mhtml");
  const outputPath = path.join(temporaryDirectory, "job-description.pdf");

  try {
    const download = await client.storage.from("temporary-captures").download(job.temporaryStoragePath);
    if (download.error) throw download.error;
    await fs.writeFile(inputPath, Buffer.from(await download.data.arrayBuffer()));

    await executeFile(process.execPath, [
      converterScript,
      "--input", inputPath,
      "--output", outputPath,
      "--company", job.company,
      "--position", job.position,
      "--original-url", job.originalUrl,
      "--captured-at", job.capturedAt,
    ], { maxBuffer: 1024 * 1024 });

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

    const cleanup = await client.storage.from("temporary-captures").remove([job.temporaryStoragePath]);
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
    const classified = classifyEmail(parsed);
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

    await matchEmailEvent(job, parsed, classified, client).catch((error: unknown) => {
      // The insert trigger leaves a default open review task, so matching failure
      // cannot lose the classified event or require retaining the raw message.
      console.error(`Email matching deferred: ${error instanceof Error ? error.message : String(error)}`);
    });

    const cleanup = await client.storage.from("inbound-emails").remove([job.storage_path]);
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
  console.log("Manager capture worker is running.");
  const runOnce = process.argv.includes("--once");
  const resendApiKey = process.env.RESEND_API_KEY?.trim();
  const inboundDomain = process.env.INBOUND_EMAIL_DOMAIN?.trim().toLowerCase();
  const resend = resendApiKey && inboundDomain ? new Resend(resendApiKey) : null;
  const configuredInterval = Number(process.env.RESEND_POLL_INTERVAL_MS);
  const resendPollInterval = Number.isFinite(configuredInterval) && configuredInterval >= 10_000
    ? configuredInterval
    : 30_000;
  let nextResendPollAt = 0;

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
    if (!captureProcessed && !emailProcessed && resendQueued === 0) {
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
