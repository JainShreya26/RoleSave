import assert from "node:assert/strict";
import test from "node:test";
import { actionTiming } from "./action-timing.ts";

const now = new Date(2026, 10, 5, 10, 0);
const at = (hour: number, day = 5) => new Date(2026, 10, day, hour, 0).toISOString();
const timing = (due: string, remind: string | null = null) => actionTiming({ due_at: due, remind_at: remind }, now);

test("an action past its due time is overdue, whatever its reminder says", () => {
  assert.equal(timing(at(9)), "overdue");
  assert.equal(timing(at(9), at(8)), "overdue");
  assert.equal(timing(at(10)), "overdue");
});

test("a reached reminder brings an action forward", () => {
  assert.equal(timing(at(12, 8), at(9)), "reminder");
  assert.equal(timing(at(12), at(9)), "reminder");
});

test("an action due today counts as due today until its reminder is reached", () => {
  assert.equal(timing(at(15)), "today");
  assert.equal(timing(at(15), at(15)), "today");
  assert.equal(timing(at(15), at(14)), "today");
});

test("a later action stays upcoming until its reminder is reached", () => {
  assert.equal(timing(at(9, 6)), "upcoming");
  assert.equal(timing(at(9, 8), at(9, 6)), "upcoming");
});
