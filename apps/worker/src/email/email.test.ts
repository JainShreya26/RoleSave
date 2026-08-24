import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { classifyEmail } from "./classify";
import { decideApplicationMatch, rankApplicationMatches, titleSimilarity } from "./match";
import { parseRawEmail } from "./parse";
import { findResendForwardingRecipient } from "./resend-poll";
import type { EmailClassification } from "./types";

const fixtureDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

async function classifyFixture(name: string) {
  const rawEmail = await fs.readFile(path.join(fixtureDirectory, name));
  const parsed = await parseRawEmail(rawEmail);
  return { classified: classifyEmail(parsed), parsed };
}

const eventFixtures: Array<[string, EmailClassification]> = [
  ["application-confirmed.eml", "APPLICATION_CONFIRMED"],
  ["assessment.eml", "ASSESSMENT_REQUESTED"],
  ["interview.eml", "INTERVIEW_REQUESTED"],
  ["rejection.eml", "REJECTION_RECEIVED"],
  ["offer.eml", "OFFER_RECEIVED"],
];

for (const [fixture, expected] of eventFixtures) {
  test(`classifies ${fixture} as ${expected}`, async () => {
    const { classified } = await classifyFixture(fixture);
    assert.equal(classified.classification, expected);
    assert.ok(classified.confidence >= 0.9);
  });
}

test("filters marketing email before retaining its body", async () => {
  const { classified, parsed } = await classifyFixture("newsletter.eml");
  assert.equal(classified.classification, "NOT_JOB_RELATED");
  assert.equal(parsed.bodyText, "");
  assert.ok(parsed.metadataScore < 20);
});

test("does not classify a negated rejection as a rejection", async () => {
  const { classified } = await classifyFixture("negated-rejection.eml");
  assert.notEqual(classified.classification, "REJECTION_RECEIVED");
});

test("extracts job IDs, meeting links, and cleaned HTML text", async () => {
  const confirmation = await classifyFixture("application-confirmed.eml");
  const interview = await classifyFixture("interview.eml");
  const assessment = await classifyFixture("assessment.eml");
  assert.equal(confirmation.classified.extractedJobId, "ENG-4821");
  assert.equal(confirmation.classified.extractedCompany, "Acme");
  assert.equal(confirmation.classified.extractedPosition, "Senior Software Engineer");
  assert.equal(interview.classified.meetingUrl, "https://calendly.com/acme/interview");
  assert.match(assessment.parsed.bodyText, /complete the technical assessment/i);
  assert.doesNotMatch(assessment.parsed.bodyText, /ignoreMe/);
});

test("extracts the employer and position from a Gmail-forwarded interview", () => {
  const classified = classifyEmail({
    bodyText: "We would like to interview you for the Integration Test Engineer\nposition at Ledger Email Flow Test.",
    hasUnsubscribe: false,
    links: [],
    messageId: "gmail-forwarded-test",
    metadataScore: 30,
    receivedAt: "2026-08-24T12:00:00.000Z",
    senderAddress: "candidate@example.com",
    senderDomain: "gmail.com",
    senderName: "Avery Candidate",
    subject: "Interview invitation for Integration Test Engineer",
    threadId: null,
  });

  assert.equal(classified.classification, "INTERVIEW_REQUESTED");
  assert.equal(classified.extractedCompany, "Ledger Email Flow Test");
  assert.equal(classified.extractedPosition, "Integration Test Engineer");
});

test("automatically matches an exact job ID when the result is unambiguous", () => {
  const candidates = rankApplicationMatches({
    extractedCompany: "Acme Inc.",
    extractedJobId: "ENG-4821",
    extractedPosition: "Senior Software Engineer",
    previousThreadApplicationId: null,
    receivedAt: "2026-08-23T18:00:00.000Z",
    senderDomain: "careers.acme.example",
  }, [
    {
      appliedAt: "2026-08-20T18:00:00.000Z",
      company: "Acme",
      createdAt: "2026-08-20T18:00:00.000Z",
      id: "application-a",
      jobId: "ENG-4821",
      originalDomain: "acme.example",
      position: "Senior Software Engineer",
    },
    {
      appliedAt: "2026-08-18T18:00:00.000Z",
      company: "Acme",
      createdAt: "2026-08-18T18:00:00.000Z",
      id: "application-b",
      jobId: "ENG-9999",
      originalDomain: "acme.example",
      position: "Product Manager",
    },
  ]);
  const decision = decideApplicationMatch(candidates);
  assert.equal(decision.automaticApplicationId, "application-a");
  assert.ok(candidates[0].score >= 100);
});

test("requires review when two applications have similar evidence", () => {
  const applications = ["application-a", "application-b"].map((id) => ({
    appliedAt: "2026-08-20T18:00:00.000Z",
    company: "Acme",
    createdAt: "2026-08-20T18:00:00.000Z",
    id,
    jobId: null,
    originalDomain: null,
    position: "Software Engineer",
  }));
  const decision = decideApplicationMatch(rankApplicationMatches({
    extractedCompany: "Acme",
    extractedJobId: null,
    extractedPosition: "Software Engineer",
    previousThreadApplicationId: null,
    receivedAt: "2026-08-23T18:00:00.000Z",
    senderDomain: null,
  }, applications));
  assert.equal(decision.automaticApplicationId, null);
  assert.deepEqual(decision.suggestedApplicationIds, ["application-a", "application-b"]);
});

test("automatically matches a unique exact company and position without a job ID", () => {
  const candidates = rankApplicationMatches({
    extractedCompany: "Ledger Email Flow Test",
    extractedJobId: null,
    extractedPosition: "Integration Test Engineer",
    previousThreadApplicationId: null,
    receivedAt: "2026-08-24T18:00:00.000Z",
    senderDomain: "gmail.com",
  }, [
    {
      appliedAt: "2026-08-23T18:00:00.000Z",
      company: "Ledger Email Flow Test",
      createdAt: "2026-08-23T18:00:00.000Z",
      id: "application-a",
      jobId: "LEDGER-EMAIL-FLOW-001",
      originalDomain: null,
      position: "Integration Test Engineer",
    },
    {
      appliedAt: "2026-08-23T18:00:00.000Z",
      company: "Different Company",
      createdAt: "2026-08-23T18:00:00.000Z",
      id: "application-b",
      jobId: null,
      originalDomain: null,
      position: "Integration Test Engineer",
    },
  ]);

  assert.equal(decideApplicationMatch(candidates).automaticApplicationId, "application-a");
});

test("normalizes company suffixes and scores similar titles", () => {
  assert.ok(titleSimilarity("Senior Software Engineer", "Sr Software Engineer") > 0.6);
});

test("finds only a Ledger recipient on the configured Resend domain", () => {
  const token = "0123456789abcdef0123456789abcdef0123";
  assert.equal(findResendForwardingRecipient({
    received_for: ["original@example.com"],
    to: [`jobs+${token}@inbound.example.com`],
  }, "inbound.example.com"), `jobs+${token}@inbound.example.com`);
  assert.equal(findResendForwardingRecipient({
    received_for: [],
    to: [`jobs+${token}@different.resend.app`],
  }, "inbound.example.com"), undefined);
});
