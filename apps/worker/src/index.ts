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

export async function expireAbandonedUploads(client: SupabaseClient) {
  const { data, error } = await client.rpc("expire_abandoned_capture_uploads");
  if (error) throw error;
  return (data as number | null) ?? 0;
}

export async function cleanupStoredPayloads(client: SupabaseClient) {
  const documentResult = await client
    .from("documents")
    .select("id,temporary_storage_path")
    .eq("capture_status", "COMPLETE")
    .not("temporary_storage_path", "is", null)
    .limit(20);
  if (documentResult.error) throw documentResult.error;

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
  return cleaned;
}

export async function enforceOperationalRetention(client: SupabaseClient, now = new Date()) {
  const payloadRetentionDays = retentionDays("FAILED_PAYLOAD_RETENTION_DAYS", 7, 1);
  const metadataRetentionDays = retentionDays("FAILED_JOB_RETENTION_DAYS", 90, 30);
  const payloadCutoff = new Date(now.getTime() - payloadRetentionDays * 86_400_000).toISOString();

  const captureResult = await client
    .from("capture_jobs")
    .select("id,document_id")
    .eq("status", "FAILED")
    .lt("failed_at", payloadCutoff)
    .limit(20);
  if (captureResult.error) throw captureResult.error;

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
  const purge = await client.rpc("purge_expired_operational_data", {
    p_failed_metadata_retention_days: metadataRetentionDays,
  });
  if (purge.error) throw purge.error;
  const counts = purge.data?.[0];
  return {
    metadataRowsDeleted: counts?.capture_jobs_deleted ?? 0,
    payloadsDeleted,
  };
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
        ? retention.metadataRowsDeleted + retention.payloadsDeleted
        : 0;
      nextRetentionAt = Date.now() + 60 * 60_000;
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
