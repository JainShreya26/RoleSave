import assert from "node:assert/strict";
import test from "node:test";

// Set before any date is read, so these tests do not depend on the machine.
process.env.TZ = "Asia/Tokyo";

const { eventTypeLabel, formatDate, formatDateTime, fromDateTimeLocal, timeAgo, toDateTimeLocal } = await import("./format.ts");

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
  assert.equal(eventTypeLabel("JD_SAVED"), "Job description saved");
  assert.equal(eventTypeLabel("MARKED_AS_APPLIED"), "Marked as applied");
  assert.equal(eventTypeLabel("MANUAL_CORRECTION"), "Status changed");
  assert.equal(eventTypeLabel("GENERAL_UPDATE"), "Update");
  // A type added later still reads as a sentence.
  assert.equal(eventTypeLabel("SOMETHING_NEW"), "Something new");
});

test("time ago uses the largest unit that reads well", () => {
  const now = Date.parse("2026-11-05T12:00:00.000Z");
  const before = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
  assert.equal(timeAgo(before(0), now), "Just now");
  assert.equal(timeAgo(before(1), now), "1 minute ago");
  assert.equal(timeAgo(before(59), now), "59 minutes ago");
  assert.equal(timeAgo(before(60), now), "1 hour ago");
  assert.equal(timeAgo(before(24 * 60), now), "1 day ago");
  assert.equal(timeAgo(before(13 * 24 * 60), now), "13 days ago");
  assert.equal(timeAgo(before(14 * 24 * 60), now), "2 weeks ago");
  assert.equal(timeAgo(before(60 * 24 * 60), now), "2 months ago");
  assert.equal(timeAgo(before(800 * 24 * 60), now), "2 years ago");
});

test("a time slightly ahead of this computer's clock counts as just now", () => {
  const now = Date.parse("2026-11-05T12:00:00.000Z");
  assert.equal(timeAgo("2026-11-05T12:03:00.000Z", now), "Just now");
});
