import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  captureJobSchema,
  captureQueueJobSchema,
  type CaptureJobInput,
  type CaptureQueueJobInput,
} from "@rolesave/validation";

const executeFile = promisify(execFile);
const converterScript = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../converter/src/convert.mjs",
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
  attempt_id: string;
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

interface StoredPayloadRow {
  id: string;
  user_id: string;
  temporary_storage_path: string;
}

type CaptureBucket = "temporary-captures" | "job-descriptions";

interface RetiredPayloadRow {
  id: string;
  document_id: string;
  user_id: string;
  bucket_id: CaptureBucket;
  storage_path: string;
}

function retentionDays(name: string, fallback: number, minimum: number, maximum = Number.MAX_SAFE_INTEGER) {
  const configured = Number(process.env[name]);
  return Number.isInteger(configured) && configured >= minimum && configured <= maximum ? configured : fallback;
}

function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return String(error);
}

/** A claimed job whose data the worker refuses to process. Retrying cannot fix it. */
export class InvalidCaptureJobError extends Error {
  override name = "InvalidCaptureJobError";
}

/** What the owner sees when a save fails, and whether another attempt could help. */
export interface CaptureFailure {
  message: string;
  retryable: boolean;
}

// Matches UNREADABLE_PAGE_EXIT_CODE in the converter.
const unreadablePageExitCode = 3;
// Docker and Podman exit with these when they cannot start the container at all.
const containerRuntimeExitCodes = new Set([125, 126, 127]);

/**
 * Turns a failure into a message for the person who saved the job. The full
 * error, which can include the converter command and server paths, only goes
 * to the worker's own log.
 */
export function describeCaptureFailure(error: unknown): CaptureFailure {
  if (error instanceof InvalidCaptureJobError) {
    return { message: "This save is incomplete and cannot become a PDF. Save the job again from its page.", retryable: false };
  }
  const failure = (error && typeof error === "object" ? error : {}) as {
    code?: unknown; killed?: unknown; signal?: unknown; syscall?: unknown;
  };
  if (failure.code === unreadablePageExitCode) {
    return {
      message: "The saved page had no readable text, so no PDF was made. Open the posting, let it finish loading, then save it again.",
      retryable: false,
    };
  }
  if (failure.killed === true || failure.signal === "SIGKILL") {
    return { message: "Making the PDF took too long.", retryable: true };
  }
  const couldNotStart = typeof failure.syscall === "string" && failure.syscall.startsWith("spawn");
  if (couldNotStart || (typeof failure.code === "number" && containerRuntimeExitCodes.has(failure.code))) {
    return { message: "The PDF converter is not available right now.", retryable: true };
  }
  return { message: "The PDF could not be created.", retryable: true };
}

function isOwnedStoragePath(storagePath: string, userId: string): boolean {
  const [owner, ...segments] = storagePath.split("/");
  // Merged applications retain their old folder. Only the owner and the
  // safety of the object key matter here.
  return owner === userId && segments.length > 0
    && segments.every((segment) => segment && !/[^a-z0-9_.-]/i.test(segment) && segment !== "." && segment !== "..");
}

async function removeCaptureObject(
  client: SupabaseClient,
  bucket: CaptureBucket,
  storagePath: string,
  userId: string,
  documentId: string,
) {
  if (!isOwnedStoragePath(storagePath, userId)) {
    console.warn(`Ignored an unsafe storage reference on capture ${documentId}.`);
    return;
  }
  const { error } = await client.storage.from(bucket).remove([storagePath]);
  if (error) throw error;
}

async function clearTemporaryCapture(
  client: SupabaseClient,
  documentId: string,
  userId: string,
  storagePath: string,
) {
  await removeCaptureObject(client, "temporary-captures", storagePath, userId, documentId);

  const { error } = await client
    .from("documents")
    .update({ temporary_storage_path: null })
    .eq("id", documentId)
    .eq("user_id", userId)
    .eq("capture_status", "COMPLETE")
    .eq("temporary_storage_path", storagePath);
  if (error) throw error;
}

export async function expireAbandonedUploads(client: SupabaseClient) {
  const { data, error } = await client.rpc("expire_abandoned_capture_uploads");
  if (error) throw error;
  return (data as number | null) ?? 0;
}

export async function cleanupStoredPayloads(client: SupabaseClient) {
  const documentResult = await client
    .from("documents")
    .select("id,user_id,temporary_storage_path")
    .eq("capture_status", "COMPLETE")
    .not("temporary_storage_path", "is", null)
    .limit(20);
  if (documentResult.error) throw documentResult.error;

  let cleaned = 0;
  for (const row of documentResult.data as StoredPayloadRow[]) {
    try {
      await clearTemporaryCapture(client, row.id, row.user_id, row.temporary_storage_path);
      cleaned += 1;
    } catch (error) {
      console.warn(`Temporary capture cleanup retry failed: ${errorMessage(error)}`);
    }
  }
  return cleaned;
}

export async function cleanupRetiredPayloads(client: SupabaseClient, now = new Date()) {
  const { data, error } = await client
    .from("capture_storage_deletions")
    .select("id,document_id,user_id,bucket_id,storage_path")
    .lte("available_at", now.toISOString())
    .order("available_at")
    .order("id")
    .limit(20);
  if (error) throw error;

  let cleaned = 0;
  for (const row of data as RetiredPayloadRow[]) {
    try {
      await removeCaptureObject(client, row.bucket_id, row.storage_path, row.user_id, row.document_id);
      const deletion = await client.from("capture_storage_deletions").delete().eq("id", row.id);
      if (deletion.error) throw deletion.error;
      cleaned += 1;
    } catch (cleanupError) {
      console.warn(`Retired capture cleanup failed: ${errorMessage(cleanupError)}`);
      // Move a failed deletion behind the rest of the batch so it cannot
      // hold up other captures.
      const retryAt = new Date(now.getTime() + 5 * 60_000).toISOString();
      const deferred = await client.from("capture_storage_deletions")
        .update({ available_at: retryAt }).eq("id", row.id);
      if (deferred.error) console.warn(`Could not defer capture cleanup: ${deferred.error.message}`);
    }
  }
  return cleaned;
}

export async function enforceOperationalRetention(client: SupabaseClient, now = new Date()) {
  const payloadRetentionDays = retentionDays("FAILED_PAYLOAD_RETENTION_DAYS", 7, 1);
  const metadataRetentionDays = retentionDays("FAILED_JOB_RETENTION_DAYS", 90, 30, 3650);
  const payloadCutoff = new Date(now.getTime() - payloadRetentionDays * 86_400_000).toISOString();
  const retired = await client.rpc("queue_expired_capture_payloads", { p_failed_before: payloadCutoff });
  if (retired.error) throw retired.error;
  const abandoned = await client.rpc("queue_abandoned_capture_outputs");
  if (abandoned.error) throw abandoned.error;

  const payloadsDeleted = await cleanupRetiredPayloads(client);
  const purge = await client.rpc("purge_expired_operational_data", {
    p_failed_metadata_retention_days: metadataRetentionDays,
  });
  if (purge.error) throw purge.error;
  const counts = purge.data?.[0];
  return {
    metadataRowsDeleted: counts?.capture_jobs_deleted ?? 0,
    payloadsDeleted,
    payloadsRetired: ((retired.data as number | null) ?? 0) + ((abandoned.data as number | null) ?? 0),
  };
}

function toQueueJob(row: ClaimedJobRow): CaptureQueueJobInput {
  const parsed = captureQueueJobSchema.safeParse({
    applicationId: row.application_id,
    attemptId: row.attempt_id,
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
  if (!parsed.success) throw new InvalidCaptureJobError(parsed.error.message);
  const job = parsed.data;
  if (!isOwnedStoragePath(job.temporaryStoragePath, job.userId)
    || !isOwnedStoragePath(job.outputStoragePath, job.userId)) {
    throw new InvalidCaptureJobError("Capture storage paths do not belong to the job owner.");
  }
  return job;
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
      upsert: false,
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

export async function runWorkerOnce(client: SupabaseClient, convert = convertAndUpload): Promise<boolean> {
  const claim = await client.rpc("claim_capture_attempt");
  if (claim.error) throw claim.error;
  const row = (claim.data as ClaimedJobRow[] | null)?.[0];
  if (!row) return false;

  let job: CaptureQueueJobInput;
  try {
    job = toQueueJob(row);
    const result = await convert(job, client);
    const completionArgs = {
      p_attempt_id: job.attemptId,
      p_checksum_sha256: result.checksumSha256,
      p_file_size_bytes: result.fileSizeBytes,
      p_job_id: job.jobId,
    };
    const complete = async () => {
      const { data, error } = await client.rpc("complete_capture_attempt", completionArgs);
      if (error) throw error;
      return data === true;
    };

    if (!await complete().catch(() => complete())) {
      throw new Error(`Capture job ${job.jobId} could not be completed.`);
    }
  } catch (error) {
    // The PDF may already be published. Retention collects attempts that
    // were released without publishing their file.
    // The owner sees only a plain message. The full error is thrown on to the
    // worker's log.
    const { message, retryable } = describeCaptureFailure(error);
    try {
      const failure = await client.rpc("fail_capture_attempt", {
        p_attempt_id: row.attempt_id,
        p_error: message,
        p_job_id: row.job_id,
        p_retryable: retryable,
      });
      if (failure.error) throw failure.error;
    } catch (recordError) {
      console.error(`Could not record capture failure: ${errorMessage(recordError)}`);
    }
    throw error;
  }

  try {
    await clearTemporaryCapture(client, job.documentId, job.userId, job.temporaryStoragePath);
  } catch (error) {
    console.warn(`Temporary capture cleanup failed: ${errorMessage(error)}`);
  }
  console.log(`Completed ${job.company} — ${job.position}`);
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
  let nextCleanupAt = 0;
  let nextRetentionAt = 0;

  while (true) {
    const captureProcessed = await runWorkerOnce(client).catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      return false;
    });
    let cleanedPayloads = 0;
    if (Date.now() >= nextCleanupAt) {
      cleanedPayloads = await cleanupStoredPayloads(client).catch((error: unknown) => {
        console.error(`Stored payload cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
        return 0;
      });
      cleanedPayloads += await cleanupRetiredPayloads(client).catch((error: unknown) => {
        console.error(`Retired payload cleanup failed: ${errorMessage(error)}`);
        return 0;
      });
      await expireAbandonedUploads(client).catch((error: unknown) => {
        console.error(`Abandoned upload cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
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
        ? retention.metadataRowsDeleted + retention.payloadsDeleted + retention.payloadsRetired
        : 0;
      nextRetentionAt = Date.now() + (retention && retention.payloadsRetired >= 20 ? 3_000 : 60 * 60_000);
    }
    if (!captureProcessed && cleanedPayloads === 0 && retentionWork === 0) {
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
