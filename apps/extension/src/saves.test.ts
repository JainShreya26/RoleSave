import assert from "node:assert/strict";
import test from "node:test";
import { describeError, isConnectionError, isSaveRequest, parseSaveAttempts, type SaveAttempt } from "./saves.ts";

const now = Date.parse("2026-11-04T12:00:00Z");
const minutesAgo = (minutes: number) => new Date(now - minutes * 60 * 1_000).toISOString();

const attempt = (overrides: Partial<SaveAttempt> = {}): SaveAttempt => ({
  company: "Acme",
  idempotencyKey: "key-1",
  position: "Data Engineer",
  startedAt: minutesAgo(1),
  status: "saving",
  url: "https://careers.acme.com/job?id=1",
  userId: "user-1",
  ...overrides,
});

test("keeps a running save and a failed save", () => {
  const parsed = parseSaveAttempts([attempt(), attempt({ error: "Boom", idempotencyKey: "key-2", status: "failed" })], now);
  assert.deepEqual(parsed.map(({ status }) => status), ["saving", "failed"]);
  assert.equal(parsed[1]?.error, "Boom");
});

test("a save still running after the background limit has died", () => {
  const [died] = parseSaveAttempts([attempt({ startedAt: minutesAgo(7) })], now);
  assert.equal(died?.status, "failed");
  assert.match(died?.error ?? "", /did not finish/);
});

test("drops old and invalid records", () => {
  const old = attempt({ error: "Boom", startedAt: minutesAgo(8 * 24 * 60), status: "failed" });
  assert.deepEqual(parseSaveAttempts([old, null, { idempotencyKey: 1 }, attempt({ startedAt: "soon" })], now), []);
  assert.deepEqual(parseSaveAttempts(undefined, now), []);
});

test("recognizes only save messages", () => {
  assert.equal(isSaveRequest({ type: "rolesave.save-job" }), true);
  assert.equal(isSaveRequest({ type: "something-else" }), false);
  assert.equal(isSaveRequest(null), false);
  assert.equal(isSaveRequest("rolesave.save-job"), false);
});

test("explains a lost connection, whatever shape the error has", () => {
  for (const error of [
    new TypeError("Failed to fetch"),
    { message: "TypeError: Failed to fetch", details: "", hint: "", code: "" },
    new Error("NetworkError when attempting to fetch resource."),
    new Error("Load failed"),
  ]) {
    assert.equal(isConnectionError(error), true);
    assert.match(describeError(error, "Fallback"), /couldn't connect.*internet connection/);
  }
});

test("explains a page that is too large", () => {
  const message = describeError({ message: "The object exceeded the maximum allowed size" }, "Fallback");
  assert.match(message, /over the 25 MB limit/);
  assert.match(message, /still on your dashboard/);
});

test("keeps other errors as they were", () => {
  assert.equal(describeError(new Error("Cannot find the tab"), "Fallback"), "Cannot find the tab");
  assert.equal(describeError({ message: "Something on the server" }, "Fallback"), "Fallback");
  assert.equal(describeError(null, "Fallback"), "Fallback");
  assert.equal(isConnectionError(new Error("Email not confirmed")), false);
  assert.equal(isConnectionError(undefined), false);
});
