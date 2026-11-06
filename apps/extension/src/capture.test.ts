import assert from "node:assert/strict";
import test from "node:test";
import { captureJob, markApplicationApplied, type CaptureDependencies, type CaptureRequest } from "./capture.ts";

const request: CaptureRequest = {
  company: "Page Company",
  jobId: "REQ-1",
  position: "Page Position",
  tabId: 7,
  url: "https://careers.acme.com/job?id=1",
};

const session = {
  application_company: "Saved Company",
  application_id: "application-1",
  application_position: "Saved Position",
  application_reused: false,
  capture_status: "PENDING",
  document_id: "document-1",
  job_id: "job-1",
  temporary_storage_path: "user/application/document.mhtml",
};

interface Scenario {
  capture?: () => Promise<Blob>;
  finalize?: { data?: boolean; error?: Error };
  prepared?: { data?: boolean; error?: Error };
  remove?: { error?: Error };
  session?: { data?: unknown[]; error?: Error };
  upload?: { error?: Error };
}

/** Records every step, in order, and answers each one from the scenario. */
function setUp(scenario: Scenario = {}) {
  const steps: string[] = [];
  const answers: Record<string, () => unknown> = {
    create_capture_session: () => scenario.session ?? { data: [session] },
    fail_capture_upload: () => ({ data: true }),
    finalize_capture_upload: () => scenario.finalize ?? { data: true },
    retry_capture_upload: () => scenario.prepared ?? { data: true },
  };
  const dependencies = {
    client: {
      rpc: async (name: string) => {
        steps.push(name);
        return answers[name]?.();
      },
      storage: {
        from: () => ({
          remove: async () => {
            steps.push("remove");
            return scenario.remove ?? {};
          },
          upload: async () => {
            steps.push("upload");
            return scenario.upload ?? {};
          },
        }),
      },
    },
    saveAsMhtml: async () => {
      steps.push("capture");
      return scenario.capture ? scenario.capture() : new Blob(["page"]);
    },
  } as unknown as CaptureDependencies;
  return { dependencies, steps };
}

const fullSave = ["capture", "create_capture_session", "retry_capture_upload", "remove", "upload", "finalize_capture_upload"];

test("a new save captures the page, uploads it, and queues the PDF", async () => {
  const { dependencies, steps } = setUp();
  const result = await captureJob(request, "key", dependencies);
  assert.deepEqual(steps, fullSave);
  assert.equal(result.applicationId, "application-1");
  assert.equal(result.reused, false);
});

test("reports the saved record's name, not the page's", async () => {
  const { dependencies } = setUp();
  const result = await captureJob(request, "key", dependencies);
  assert.equal(result.company, "Saved Company");
  assert.equal(result.position, "Saved Position");
});

test("falls back to the page's name if the server does not send one", async () => {
  const { application_company: _company, application_position: _position, ...older } = session;
  const { dependencies } = setUp({ session: { data: [older] } });
  const result = await captureJob(request, "key", dependencies);
  assert.equal(result.company, "Page Company");
  assert.equal(result.position, "Page Position");
});

test("always clears any earlier upload before uploading", async () => {
  // The session is still PENDING when an earlier upload's response was lost.
  const { dependencies, steps } = setUp({ session: { data: [{ ...session, capture_status: "PENDING" }] } });
  await captureJob(request, "key", dependencies);
  assert.ok(steps.indexOf("remove") < steps.indexOf("upload"));
});

test("a posting that already has its capture uploads nothing", async () => {
  const { dependencies, steps } = setUp({
    prepared: { data: false },
    session: { data: [{ ...session, application_reused: true, capture_status: "COMPLETE" }] },
  });
  const result = await captureJob(request, "key", dependencies);
  assert.deepEqual(steps, ["capture", "create_capture_session", "retry_capture_upload"]);
  assert.equal(result.reused, true);
});

test("a failed capture creates nothing on the server", async () => {
  const { dependencies, steps } = setUp({ capture: () => Promise.reject(new Error("Tab is gone")) });
  await assert.rejects(captureJob(request, "key", dependencies), /Tab is gone/);
  assert.deepEqual(steps, ["capture"]);
});

test("a failed session has nothing to mark as failed", async () => {
  const { dependencies, steps } = setUp({ session: { error: new Error("Company too long") } });
  await assert.rejects(captureJob(request, "key", dependencies), /Company too long/);
  assert.equal(steps.includes("fail_capture_upload"), false);
});

test("an empty session is an error", async () => {
  const { dependencies } = setUp({ session: { data: [] } });
  await assert.rejects(captureJob(request, "key", dependencies), /could not be created/);
});

for (const [name, scenario, message] of [
  ["preparing", { prepared: { error: new Error("Prepare failed") } }, /Prepare failed/],
  ["clearing", { remove: { error: new Error("Remove failed") } }, /Remove failed/],
  ["uploading", { upload: { error: new Error("Upload failed") } }, /Upload failed/],
  ["finalizing", { finalize: { error: new Error("Finalize failed") } }, /Finalize failed/],
  ["being refused the queue", { finalize: { data: false } }, /could not be queued/],
] as const) {
  test(`a failure while ${name} marks the capture as failed`, async () => {
    const { dependencies, steps } = setUp(scenario);
    await assert.rejects(captureJob(request, "key", dependencies), message);
    assert.equal(steps.at(-1), "fail_capture_upload");
  });
}

function markClient(marked: { data?: boolean; error?: Error }, existing: { data?: unknown; error?: Error } = {}) {
  return {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => existing }) }) }),
    rpc: async () => marked,
  } as unknown as Parameters<typeof markApplicationApplied>[1];
}

test("marking as applied reports what really happened", async () => {
  assert.equal(await markApplicationApplied("id", markClient({ data: true })), "applied");
  assert.equal(await markApplicationApplied("id", markClient({ data: false }, { data: { id: "id" } })), "later-stage");
  assert.equal(await markApplicationApplied("id", markClient({ data: false }, { data: null })), "missing");
});

test("marking as applied passes on errors", async () => {
  await assert.rejects(markApplicationApplied("id", markClient({ error: new Error("Offline") })), /Offline/);
  await assert.rejects(markApplicationApplied("id", markClient({ data: false }, { error: new Error("Lookup failed") })), /Lookup failed/);
});
