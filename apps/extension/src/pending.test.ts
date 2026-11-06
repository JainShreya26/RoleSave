import assert from "node:assert/strict";
import test from "node:test";
import { addPendingApplication, findPendingForPage, parsePendingApplications, type PendingApplication } from "./pending.ts";

const now = Date.parse("2026-11-04T12:00:00Z");
const daysAgo = (days: number) => new Date(now - days * 24 * 60 * 60 * 1_000).toISOString();

const item = (overrides: Partial<PendingApplication> = {}): PendingApplication => ({
  applicationId: "a",
  company: "Acme",
  position: "Data Engineer",
  savedAt: daysAgo(1),
  url: "https://careers.acme.com/job?id=1",
  userId: "user-1",
  ...overrides,
});

test("reads a list, newest first", () => {
  const parsed = parsePendingApplications([item({ applicationId: "old", savedAt: daysAgo(3) }), item({ applicationId: "new" })], now);
  assert.deepEqual(parsed.map(({ applicationId }) => applicationId), ["new", "old"]);
});

test("drops expired and invalid records, and records with no account", () => {
  const { userId: _userId, ...noAccount } = item({ applicationId: "no-account" });
  const parsed = parsePendingApplications(
    [item({ applicationId: "expired", savedAt: daysAgo(8) }), item({ savedAt: "not a date" }), { applicationId: 1 }, null, noAccount, item({ applicationId: "kept" })],
    now,
  );
  assert.deepEqual(parsed.map(({ applicationId }) => applicationId), ["kept"]);
  assert.deepEqual(parsePendingApplications(undefined, now), []);
  assert.deepEqual(parsePendingApplications(item(), now), []);
});

test("adding replaces the same application", () => {
  const next = addPendingApplication([item({ position: "Old title" })], item({ position: "New title" }));
  assert.deepEqual(next.map(({ position }) => position), ["New title"]);
});

test("the limit applies per account and leaves other accounts alone", () => {
  const mine = Array.from({ length: 10 }, (_, index) => item({ applicationId: `mine-${index}` }));
  const theirs = item({ applicationId: "theirs", userId: "user-2" });
  const next = addPendingApplication([...mine, theirs], item({ applicationId: "newest" }));
  assert.equal(next.filter(({ userId }) => userId === "user-1").length, 10);
  assert.equal(next[0]?.applicationId, "newest");
  assert.equal(next.some(({ applicationId }) => applicationId === "mine-9"), false);
  assert.equal(next.some(({ applicationId }) => applicationId === "theirs"), true);
});

test("matches the same page, ignoring a fragment and trailing slash", () => {
  const page = { company: "Other", position: "Other", url: "https://careers.acme.com/job/?id=1#apply" };
  assert.equal(findPendingForPage([item()], page)?.applicationId, "a");
});

test("matches a separate apply page by company and position", () => {
  const page = { company: "acme", position: " data engineer ", url: "https://careers.acme.com/apply/99" };
  assert.equal(findPendingForPage([item()], page)?.applicationId, "a");
});

test("does not match a different job", () => {
  const otherId = { company: "Acme", position: "Designer", url: "https://careers.acme.com/job?id=2" };
  assert.equal(findPendingForPage([item()], otherId), undefined);
  const emptyFields = { company: "", position: "", url: "https://example.com/" };
  assert.equal(findPendingForPage([item({ company: "", position: "" })], emptyFields), undefined);
  assert.equal(findPendingForPage([item()], null), undefined);
});
