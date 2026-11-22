import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFailedJobItems,
  failedJobsEmptyMessage,
  formatFailedJobsCount,
  formatProcessingAttempts,
  validatedCaptureReplayId,
} from "./failed-job-features.ts";

test("failed captures are named, defaulted, and sorted newest first", () => {
  const jobs = buildFailedJobItems(
    [
      {
        application_id: "application-old",
        attempt_count: 0,
        document_id: "document-old",
        failed_at: "2026-11-04T18:00:00.000Z",
        id: "job-old",
        last_error: null,
      },
      {
        application_id: "application-new",
        attempt_count: 3,
        document_id: "document-new",
        failed_at: "2026-11-05T18:00:00.000Z",
        id: "job-new",
        last_error: "Converter failed.",
      },
    ],
    [{ id: "application-new", company: "New Co", position: "Engineer" }],
  );

  assert.deepEqual(jobs.map(({ id }) => id), ["job-new", "job-old"]);
  assert.deepEqual(jobs[0], {
    attemptCount: 3,
    company: "New Co",
    failedAt: "2026-11-05T18:00:00.000Z",
    id: "job-new",
    kind: "CAPTURE",
    lastError: "Converter failed.",
    position: "Engineer",
    replayId: "document-new",
  });
  assert.equal(jobs[1]?.company, null);
  assert.equal(jobs[1]?.position, null);
  assert.equal(jobs[1]?.lastError, "Capture processing failed.");
});

test("processing attempts read naturally, including upload failures", () => {
  assert.equal(formatProcessingAttempts(0), "No processing attempts");
  assert.equal(formatProcessingAttempts(1), "1 processing attempt");
  assert.equal(formatProcessingAttempts(3), "3 processing attempts");
});

test("the operations summary covers the badge and empty state", () => {
  assert.equal(formatFailedJobsCount(0), "0 failed");
  assert.equal(formatFailedJobsCount(12), "12 failed");
  assert.equal(failedJobsEmptyMessage, "Failed captures that need attention will appear here.");
});

test("a capture retry requires the expected kind and a document replay ID", () => {
  const documentId = "b7930d1c-a99d-469f-8f24-80d871e92d23";
  assert.equal(validatedCaptureReplayId("CAPTURE", documentId), documentId);
  assert.equal(validatedCaptureReplayId("EMAIL", documentId), null);
  assert.equal(validatedCaptureReplayId("CAPTURE", "not-a-uuid"), null);
  assert.equal(validatedCaptureReplayId("CAPTURE", null), null);
});
