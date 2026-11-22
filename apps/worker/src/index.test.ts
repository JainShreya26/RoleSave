import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import {
  cleanupStoredPayloads,
  createConverterInvocation,
  describeCaptureFailure,
  InvalidCaptureJobError,
  processCaptureJob,
  runWorkerOnce,
} from "./index";

const job = {
  applicationId: "11223344-1122-4122-8122-112233445566", documentId: "22334455-2233-4233-8233-223344556677",
  userId: "33445566-3344-4344-8344-334455667788", temporaryStoragePath: "user/app/capture.mhtml",
  outputStoragePath: "user/app/job-description.pdf", company: "Example", position: "Engineer",
  originalUrl: "https://jobs.example.test/engineer", capturedAt: "2026-08-23T14:00:00-04:00",
};

test("moves a successful capture through processing and complete", async () => {
  const statuses: string[] = [];
  const result = await processCaptureJob(job, {
    setStatus: async (_id, status) => { statuses.push(status); },
    convert: async () => ({ fileSizeBytes: 42, checksumSha256: "abc" }),
  });
  assert.deepEqual(statuses, ["PROCESSING", "COMPLETE"]);
  assert.equal(result.fileSizeBytes, 42);
});

test("marks a failed conversion without swallowing the error", async () => {
  const statuses: string[] = [];
  await assert.rejects(() => processCaptureJob(job, {
    setStatus: async (_id, status) => { statuses.push(status); },
    convert: async () => { throw new Error("conversion failed"); },
  }), /conversion failed/);
  assert.deepEqual(statuses, ["PROCESSING", "FAILED"]);
});

test("runs MHTML conversion in a disposable networkless container", () => {
  const invocation = createConverterInvocation("/tmp/rolesave-test", "container");
  assert.match(invocation.command, /^(docker|podman)$/);
  assert.ok(invocation.args.includes("--rm"));
  assert.ok(invocation.args.includes("--network=none"));
  assert.ok(invocation.args.includes("--read-only"));
  assert.ok(invocation.args.includes("--cap-drop=ALL"));
  assert.ok(invocation.args.includes("--security-opt=no-new-privileges"));
  assert.ok(invocation.args.includes("--input"));
  assert.ok(!invocation.args.some((value) => value.includes("Example")));
});

test("rejects local MHTML conversion in production", () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    assert.throws(() => createConverterInvocation("/tmp/rolesave-test", "local"), /disabled in production/);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

const attemptId = "55667788-5566-4566-8566-556677889900";
const claimedJob = {
  job_id: "44556677-4455-4455-8455-445566778899",
  attempt_id: attemptId,
  application_id: job.applicationId,
  document_id: job.documentId,
  user_id: job.userId,
  temporary_storage_path: `${job.userId}/old-application/capture.mhtml`,
  output_storage_path: `${job.userId}/capture-attempts/${job.documentId}/${attemptId}.pdf`,
  company: job.company,
  job_position: job.position,
  original_url: job.originalUrl,
  captured_at: job.capturedAt,
};

function workerClient(handle: (url: URL, method: string, body: Record<string, unknown>) => Response) {
  return createClient("http://worker.test", "worker-test-key", {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      fetch: async (request, init) => handle(
        new URL(request instanceof Request ? request.url : request),
        init?.method ?? "GET",
        typeof init?.body === "string" ? JSON.parse(init.body) : {},
      ),
    },
  });
}

test("an invalid claim records the validation error immediately without touching storage", async () => {
  let failure: Record<string, unknown> | undefined;
  const requests: string[] = [];
  const client = workerClient((url, _method, body) => {
    requests.push(url.pathname);
    if (url.pathname === "/rest/v1/rpc/claim_capture_attempt") {
      return Response.json([{ ...claimedJob, temporary_storage_path: null }]);
    }
    assert.equal(url.pathname, "/rest/v1/rpc/fail_capture_attempt");
    failure = body;
    return Response.json(true);
  });
  // The full validation error goes to the worker log; the owner gets a plain message.
  await assert.rejects(runWorkerOnce(client, async () => assert.fail("Invalid data reached conversion")), /temporaryStoragePath/);
  assert.equal(failure?.p_job_id, claimedJob.job_id);
  assert.equal(failure?.p_attempt_id, claimedJob.attempt_id);
  assert.doesNotMatch(String(failure?.p_error), /temporaryStoragePath/);
  assert.match(String(failure?.p_error), /Save the job again/);
  assert.equal(failure?.p_retryable, false);
  assert.deepEqual(requests, ["/rest/v1/rpc/claim_capture_attempt", "/rest/v1/rpc/fail_capture_attempt"]);
});

function commandFailure(code: number | string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(
    "Command failed: docker run --rm --volume=/var/folders/x/rolesave-worker-abc:/work:rw rolesave-mhtml-converter:local\nboom",
  ), { code, ...extra });
}

test("a page with no readable text fails at once with a plain message", () => {
  const failure = describeCaptureFailure(commandFailure(3));
  assert.equal(failure.retryable, false);
  assert.match(failure.message, /no readable text/);
});

test("a converter failure never shows the command or server paths", () => {
  for (const error of [commandFailure(1), commandFailure(125), commandFailure("ENOENT", { syscall: "spawn docker" })]) {
    const { message } = describeCaptureFailure(error);
    assert.doesNotMatch(message, /docker|\/var\/|--volume|rolesave-worker|Command failed/);
  }
});

test("failures that may pass on their own are retried", () => {
  assert.deepEqual(describeCaptureFailure(commandFailure(1, { killed: true, signal: "SIGKILL" })), {
    message: "Making the PDF took too long.", retryable: true,
  });
  assert.equal(describeCaptureFailure(commandFailure("ENOENT", { syscall: "spawn docker" })).message,
    "The PDF converter is not available right now.");
  assert.equal(describeCaptureFailure(commandFailure(125)).retryable, true);
  assert.deepEqual(describeCaptureFailure(new Error("Storage is down")), {
    message: "The PDF could not be created.", retryable: true,
  });
});

test("an unsafe or incomplete claim is not retried", () => {
  assert.equal(describeCaptureFailure(new InvalidCaptureJobError("bad path")).retryable, false);
});

test("a claimed job cannot use another owner's file or a path outside its owner folder", async () => {
  for (const untrusted of [
    { temporary_storage_path: `${job.applicationId}/capture.mhtml` },
    { output_storage_path: `${job.userId}/%2e%2e/${job.applicationId}/job.pdf` },
  ]) {
    let failed = false;
    const client = workerClient((url) => {
      if (url.pathname === "/rest/v1/rpc/claim_capture_attempt") {
        return Response.json([{ ...claimedJob, ...untrusted }]);
      }
      assert.equal(url.pathname, "/rest/v1/rpc/fail_capture_attempt");
      failed = true;
      return Response.json(true);
    });
    await assert.rejects(runWorkerOnce(client, async () => assert.fail("Unsafe path reached conversion")), /job owner/);
    assert.ok(failed);
  }
});

test("a legacy document pointing at another owner cannot trigger privileged storage deletion", async () => {
  let clearedReference = false;
  const client = workerClient((url, method, body) => {
    assert.equal(url.pathname, "/rest/v1/documents");
    if (method === "GET") {
      return Response.json([{
        id: job.documentId,
        user_id: job.userId,
        temporary_storage_path: `${job.applicationId}/victim/capture.mhtml`,
      }]);
    }
    assert.equal(method, "PATCH");
    assert.equal(url.searchParams.get("id"), `eq.${job.documentId}`);
    assert.deepEqual(body, { temporary_storage_path: null });
    clearedReference = true;
    return new Response(null, { status: 204 });
  });
  await cleanupStoredPayloads(client);
  assert.ok(clearedReference);
});

test("a lost completion response retries the same result and only removes the temporary capture", async () => {
  const completions: Record<string, unknown>[] = [];
  const removals: unknown[] = [];
  const client = workerClient((url, method, body) => {
    switch (url.pathname) {
      case "/rest/v1/rpc/claim_capture_attempt":
        return Response.json([claimedJob]);
      case "/rest/v1/rpc/complete_capture_attempt":
        completions.push(body);
        return completions.length === 1
          ? Response.json({ message: "Completion response lost" }, { status: 500 })
          : Response.json(true);
      case "/storage/v1/object/temporary-captures":
        assert.equal(method, "DELETE");
        removals.push(body.prefixes);
        return Response.json([]);
      case "/rest/v1/documents":
        return new Response(null, { status: 204 });
      default:
        return assert.fail(`Unexpected request to ${url.pathname}`);
    }
  });
  const convert = async () => ({ fileSizeBytes: 42, checksumSha256: "checksum" });
  assert.equal(await runWorkerOnce(client, convert), true);
  assert.deepEqual(completions, Array(2).fill({
    p_job_id: claimedJob.job_id, p_attempt_id: claimedJob.attempt_id,
    p_file_size_bytes: 42, p_checksum_sha256: "checksum",
  }));
  assert.deepEqual(removals, [[claimedJob.temporary_storage_path]]);
});

test("a completion that remains uncertain preserves both stored files", async () => {
  let completions = 0;
  let failures = 0;
  const deletes: string[] = [];
  const client = workerClient((url, method) => {
    if (method === "DELETE") deletes.push(url.pathname);
    switch (url.pathname) {
      case "/rest/v1/rpc/claim_capture_attempt":
        return Response.json([claimedJob]);
      case "/rest/v1/rpc/complete_capture_attempt":
        completions += 1;
        return Response.json({ message: "Completion response lost" }, { status: 500 });
      case "/rest/v1/rpc/fail_capture_attempt":
        failures += 1;
        return Response.json(false); // The database already committed the completion.
      default:
        return assert.fail(`Unexpected request to ${url.pathname}`);
    }
  });
  await assert.rejects(runWorkerOnce(client, async () => ({ fileSizeBytes: 42, checksumSha256: "checksum" })), {
    message: "Completion response lost",
  });
  assert.equal(completions, 2);
  assert.equal(failures, 1);
  assert.deepEqual(deletes, []);
});

test("a rejected attempt leaves the shared source available to the next worker", async () => {
  const requests: string[] = [];
  const client = workerClient((url, _method, body) => {
    requests.push(url.pathname);
    if (url.pathname === "/rest/v1/rpc/claim_capture_attempt") return Response.json([claimedJob]);
    assert.equal(body.p_attempt_id, claimedJob.attempt_id);
    assert.equal(body.p_job_id, claimedJob.job_id);
    return Response.json(false);
  });
  await assert.rejects(
    runWorkerOnce(client, async () => ({ fileSizeBytes: 42, checksumSha256: "checksum" })),
    /could not be completed/,
  );
  assert.deepEqual(requests, [
    "/rest/v1/rpc/claim_capture_attempt",
    "/rest/v1/rpc/complete_capture_attempt",
    "/rest/v1/rpc/fail_capture_attempt",
  ]);
});
