import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { classifyEmail } from "./classify";
import { decideEmailMatch, type EmailMatchCandidate } from "./match";
import { buildEmailSignals, collectCompanyMentions } from "./signals";
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

test("keeps a bounded marketing preview so ignored email is recoverable", async () => {
  const { classified, parsed } = await classifyFixture("newsletter.eml");
  assert.equal(classified.classification, "NOT_JOB_RELATED");
  assert.match(parsed.bodyText, /recommended jobs for you/i);
  assert.ok(parsed.metadataScore < 20);
});

test("classifies a direct-employer application confirmation without an ATS domain", async () => {
  const { classified, parsed } = await classifyFixture("direct-employer-confirmation.eml");
  assert.equal(parsed.metadataScore, 35);
  assert.equal(classified.classification, "APPLICATION_CONFIRMED");
  assert.equal(classified.extractedCompany, "Northstar Labs");
  assert.equal(classified.extractedPosition, "Data Scientist");
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
    bodyText: "We would like to interview you for the Integration Test Engineer\nposition at RoleSave Email Flow Test.",
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
  assert.equal(classified.extractedCompany, "RoleSave Email Flow Test");
  assert.equal(classified.extractedPosition, "Integration Test Engineer");
});

function candidate(overrides: Partial<EmailMatchCandidate> & { applicationId: string }): EmailMatchCandidate {
  return {
    company: "Acme",
    companyConflict: false,
    companyExact: false,
    companySimilarity: 0,
    daysApart: 3,
    matchedJobId: false,
    matchedTenant: false,
    matchedThread: false,
    matchedTokens: [],
    position: "Software Engineer",
    ...overrides,
  };
}

test("attaches on an exact job ID when it points at one application", () => {
  const decision = decideEmailMatch([
    candidate({ applicationId: "application-a", matchedJobId: true, companyExact: true }),
    candidate({ applicationId: "application-b", matchedTokens: ["acme"] }),
  ]);
  assert.equal(decision.tier, "IDENTITY");
  assert.equal(decision.automaticApplicationId, "application-a");
});

test("an exact job ID wins even when the message names a different company", () => {
  // A Workday rejection quoting the requisition number while calling the
  // employer by its parent company. The identifier is conclusive; the
  // differing name is evidence to record, not a reason to discard the match.
  const decision = decideEmailMatch([
    candidate({
      applicationId: "application-a",
      company: "Harbor Insurance Company",
      companyConflict: true,
      matchedJobId: true,
      matchedTokens: ["harbor"],
    }),
  ]);
  assert.equal(decision.tier, "IDENTITY");
  assert.equal(decision.automaticApplicationId, "application-a");
});

test("attaches on a unique company with no position anywhere in the message", () => {
  // The synthetic Northwind confirmation names the employer, never the role.
  const decision = decideEmailMatch([
    candidate({
      applicationId: "application-a",
      company: "Northwind, N.A.",
      companyExact: true,
      companySimilarity: 1,
      daysApart: 0,
      matchedTokens: ["northwind"],
    }),
  ]);
  assert.equal(decision.tier, "ENTITY");
  assert.equal(decision.automaticApplicationId, "application-a");
});

test("attaches when the company appears only in the sender domain", () => {
  // A hiring manager writing from hiring.manager@northwind.example, with the company
  // name present nowhere except the address.
  const decision = decideEmailMatch([
    candidate({
      applicationId: "application-a",
      company: "Northwind, N.A.",
      daysApart: 0.9,
      matchedTokens: ["northwind"],
    }),
  ]);
  assert.equal(decision.tier, "ENTITY");
  assert.equal(decision.automaticApplicationId, "application-a");
});

test("requires review when one employer has several open roles", () => {
  const decision = decideEmailMatch([
    candidate({ applicationId: "application-a", companyExact: true, position: "Data Scientist" }),
    candidate({ applicationId: "application-b", companyExact: true, position: "Analyst" }),
  ]);
  assert.equal(decision.automaticApplicationId, null);
  assert.deepEqual(decision.suggestedApplicationIds, ["application-a", "application-b"]);
});

test("does not attach on a generic token alone", () => {
  // "test" is a real token of "Ledger Email Flow Test" but appears in ordinary
  // mail constantly; retrieving a candidate on it must not attach one.
  const decision = decideEmailMatch([
    candidate({ applicationId: "application-a", company: "Ledger Email Flow Test", matchedTokens: ["test"] }),
  ]);
  assert.equal(decision.tier, "REVIEW");
  assert.equal(decision.automaticApplicationId, null);
});

test("recency breaks ties without creating them", () => {
  // Equal evidence, different ages. The older application must not be
  // promoted by proximity alone, but it must order behind the newer one.
  const decision = decideEmailMatch([
    candidate({ applicationId: "application-old", company: "Acme", matchedTokens: ["acme"], daysApart: 30 }),
    candidate({ applicationId: "application-new", company: "Beta", matchedTokens: ["beta"], daysApart: 1 }),
  ]);
  assert.equal(decision.automaticApplicationId, null);
  assert.equal(decision.suggestedApplicationIds[0], "application-new");
});

test("reports no match rather than guessing when nothing was retrieved", () => {
  const decision = decideEmailMatch([]);
  assert.equal(decision.automaticApplicationId, null);
  assert.equal(decision.confidence, 0);
});

test("gathers company mentions from the sender name and the subject", async () => {
  const parsed = await parseRawEmail(await fs.readFile(path.join(fixtureDirectory, "dotted-company-confirmation.eml")));
  const mentions = collectCompanyMentions(parsed);
  // The dotted abbreviation must survive; truncating at the period produced
  // "Northwind, N" and lost the match entirely.
  assert.ok(mentions.some((mention) => /^Northwind, N\.A\.$/.test(mention)), `got ${JSON.stringify(mentions)}`);
});

test("searches the sender domain for company tokens", async () => {
  const parsed = await parseRawEmail(await fs.readFile(path.join(fixtureDirectory, "manager-note.eml")));
  const signals = buildEmailSignals(parsed);
  assert.ok(signals.tokens.includes("northwind"), `got ${JSON.stringify(signals.tokens)}`);
  // A person's name must not be offered as an employer.
  assert.ok(!signals.companyMentions.includes("Jane Doe"));
});

test("collects requisition IDs written in prose", async () => {
  const parsed = await parseRawEmail(await fs.readFile(path.join(fixtureDirectory, "workday-rejection.eml")));
  const signals = buildEmailSignals(parsed);
  assert.ok(signals.jobIdMentions.includes("REQ-48391"), `got ${JSON.stringify(signals.jobIdMentions)}`);
});


test("classifies a rejection whose phrase is split by a line wrap", async () => {
  // Real mail is hard-wrapped near 72 characters, so "decided to move forward
  // with other candidates" routinely straddles a newline. Matching the rules
  // against the raw body silently missed every such message.
  const parsed = await parseRawEmail(await fs.readFile(path.join(fixtureDirectory, "wrapped-rejection.eml")));
  assert.match(parsed.bodyText, /move forward\nwith other candidates/);
  assert.equal(classifyEmail(parsed).classification, "REJECTION_RECEIVED");
});

test("reads a requisition ID that wraps after the keyword", async () => {
  const parsed = await parseRawEmail(await fs.readFile(path.join(fixtureDirectory, "wrapped-rejection.eml")));
  assert.equal(classifyEmail(parsed).extractedJobId, "REQ-48391");
});

test("an old exact identity outranks a recent weak match", () => {
  // Filtering by age before the identity tiers ran removed the exact job-ID
  // match from the pool entirely and attached the token match instead.
  const decision = decideEmailMatch([
    candidate({ applicationId: "old-exact", company: "Acme", matchedJobId: true, companyExact: true, daysApart: 500 }),
    candidate({ applicationId: "recent-weak", company: "Beta", matchedTokens: ["betatech"], daysApart: 5 }),
  ]);
  assert.equal(decision.tier, "IDENTITY");
  assert.equal(decision.automaticApplicationId, "old-exact");
});

test("an uncorroborated requisition number does not attach", () => {
  // "REQ-48391" is a format two employers will both use. Quoted in prose with
  // nothing else tying the message to this role, it is not proof of identity.
  const decision = decideEmailMatch([
    candidate({
      applicationId: "application-a",
      company: "Acme Health",
      companyConflict: true,
      matchedJobId: true,
      matchedTokens: [],
    }),
  ]);
  assert.equal(decision.automaticApplicationId, null);
});

test("a requisition number corroborated by a company token still attaches", () => {
  // The parent-company case: the message says "Harbor Group" where the saved
  // role says "Harbor Insurance", and the tenant token supplies the scope.
  const decision = decideEmailMatch([
    candidate({
      applicationId: "application-a",
      company: "Harbor Insurance Company",
      companyConflict: true,
      matchedJobId: true,
      matchedTokens: ["harbor"],
    }),
  ]);
  assert.equal(decision.tier, "IDENTITY");
  assert.equal(decision.automaticApplicationId, "application-a");
});

test("a recruiting phrase inside bulk mail is not an event", async () => {
  // A digest scoring -80 on sender and subject used to classify as an
  // interview request at 0.92 and drive an automatic status change.
  const parsed = await parseRawEmail(await fs.readFile(path.join(fixtureDirectory, "bulk-digest.eml")));
  assert.ok(parsed.hasUnsubscribe);
  assert.ok(parsed.metadataScore < 0, `score was ${parsed.metadataScore}`);
  const classified = classifyEmail(parsed);
  assert.equal(classified.classification, "NOT_JOB_RELATED");
  assert.match(classified.evidence, /Bulk mail matched/);
});

test("an ATS notification carrying an unsubscribe header is still an event", async () => {
  // Real notifications often include List-Unsubscribe. They must not be swept
  // up by the bulk-mail gate, which is why it needs a negative score too.
  const parsed = await parseRawEmail(await fs.readFile(path.join(fixtureDirectory, "ats-with-unsubscribe.eml")));
  assert.ok(parsed.hasUnsubscribe);
  assert.equal(classifyEmail(parsed).classification, "INTERVIEW_REQUESTED");
});

test("finds only a RoleSave recipient on the configured Resend domain", () => {
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
