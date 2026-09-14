import assert from "node:assert/strict";
import test from "node:test";
import { createConverterInvocation, processCaptureJob, reconsiderClassification } from "./index";
import type { EmailMatchCandidate } from "./email/match";
import type { ClassifiedEmail, ParsedEmail } from "./email/types";

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

function parsedEmail(overrides: Partial<ParsedEmail> = {}): ParsedEmail {
  return {
    bodyText: "Are you free Thursday to talk about the role?",
    hasUnsubscribe: false,
    links: [],
    messageId: "<note@northwind.example>",
    metadataScore: 0,
    receivedAt: "2026-08-26T14:00:00.000Z",
    senderAddress: "hiring.manager@northwind.example",
    senderDomain: "northwind.example",
    senderName: "Hiring Manager",
    subject: "Quick chat?",
    threadId: null,
    ...overrides,
  };
}

function ignored(overrides: Partial<ClassifiedEmail> = {}): ClassifiedEmail {
  return {
    classification: "NOT_JOB_RELATED",
    confidence: 0.85,
    evidence: "No recruiting event was detected; metadata score was 0.",
    extractedCompany: null,
    extractedJobId: null,
    extractedPosition: null,
    meetingUrl: null,
    ...overrides,
  };
}

function candidate(overrides: Partial<EmailMatchCandidate> = {}): EmailMatchCandidate {
  return {
    applicationId: "application-a",
    company: "Northwind, N.A.",
    companyConflict: false,
    companyExact: false,
    companySimilarity: 0,
    daysApart: 0.9,
    matchedJobId: false,
    matchedTenant: false,
    matchedThread: false,
    matchedTokens: [],
    position: "Artificial Intelligence Analyst, I",
    ...overrides,
  };
}

test("rescues an ignored message that refers to a tracked application", () => {
  // A hiring manager writing from the employer's own domain scores zero on
  // every metadata signal, which used to discard the most valuable mail in
  // the funnel before matching ever ran.
  const result = reconsiderClassification(
    ignored(),
    parsedEmail(),
    [candidate({ matchedTokens: ["northwind"] })],
  );
  assert.equal(result.classification, "UNKNOWN_EMAIL_EVENT");
  assert.match(result.evidence, /refers to a tracked application/);
});

test("leaves bulk mail ignored even when it names a tracked employer", () => {
  // A job-alert digest listing an employer you applied to is still a digest.
  const result = reconsiderClassification(
    ignored(),
    parsedEmail({ hasUnsubscribe: true, subject: "Your weekly job alert" }),
    [candidate({ companyExact: true })],
  );
  assert.equal(result.classification, "NOT_JOB_RELATED");
});

test("does not rescue on a generic shared word", () => {
  const result = reconsiderClassification(
    ignored(),
    parsedEmail(),
    [candidate({ company: "Ledger Email Flow Test", matchedTokens: ["test"] })],
  );
  assert.equal(result.classification, "NOT_JOB_RELATED");
});

test("does not rescue when nothing was retrieved", () => {
  assert.equal(reconsiderClassification(ignored(), parsedEmail(), []).classification, "NOT_JOB_RELATED");
});

test("leaves an already recognized classification untouched", () => {
  const confirmed = ignored({ classification: "APPLICATION_CONFIRMED", confidence: 0.92 });
  const result = reconsiderClassification(confirmed, parsedEmail(), [candidate({ companyExact: true })]);
  assert.equal(result.classification, "APPLICATION_CONFIRMED");
  assert.equal(result.confidence, 0.92);
});
