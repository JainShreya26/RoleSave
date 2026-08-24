import assert from "node:assert/strict";
import test from "node:test";
import { processCaptureJob } from "./index";

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
