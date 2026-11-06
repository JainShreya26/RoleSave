import assert from "node:assert/strict";
import test from "node:test";

// Set before any date is read, so these tests do not depend on the machine.
process.env.TZ = "Asia/Tokyo";

const { eventTypeLabel, formatDate, formatDateTime, fromDateTimeLocal, toDateTimeLocal } = await import("./format.ts");

// 02:00 UTC on Oct 2 is the evening of Oct 1 in New York and the morning of Oct 2 in Tokyo.
const lateEvening = "2026-10-02T02:00:00.000Z";

test("dates follow the requested time zone", () => {
  assert.equal(formatDate(lateEvening, undefined, "America/New_York"), "Oct 1, 2026");
  assert.equal(formatDate(lateEvening, undefined, "Asia/Tokyo"), "Oct 2, 2026");
  assert.equal(formatDate(lateEvening, undefined, "UTC"), "Oct 2, 2026");
});

test("times follow the requested time zone", () => {
  assert.match(formatDateTime(lateEvening, undefined, "America/New_York"), /^Oct 1, 2026, 10:00\sPM$/);
  assert.match(formatDateTime(lateEvening, undefined, "Asia/Tokyo"), /^Oct 2, 2026, 11:00\sAM$/);
});

test("a missing date shows the fallback", () => {
  assert.equal(formatDate(null), "Not recorded");
  assert.equal(formatDateTime(null, "Never"), "Never");
});

test("a typed time is read in this computer's time zone", () => {
  assert.equal(fromDateTimeLocal("2026-10-15T23:30"), "2026-10-15T14:30:00.000Z");
});

test("a stored time is shown in this computer's time zone", () => {
  assert.equal(toDateTimeLocal("2026-10-15T14:30:00.000Z"), "2026-10-15T23:30");
  assert.equal(toDateTimeLocal(null), "");
});

test("typing a stored time back gives the same time", () => {
  assert.equal(fromDateTimeLocal(toDateTimeLocal(lateEvening)), lateEvening);
});

test("an empty input stores nothing", () => {
  assert.equal(fromDateTimeLocal(""), "");
  assert.equal(fromDateTimeLocal("not a date"), "");
});

test("timeline event types read as labels", () => {
  assert.equal(eventTypeLabel("JD_SAVED"), "JD Saved");
  assert.equal(eventTypeLabel("MARKED_AS_APPLIED"), "Marked As Applied");
  assert.equal(eventTypeLabel("APPLICATION_WITHDRAWN"), "Application Withdrawn");
});
