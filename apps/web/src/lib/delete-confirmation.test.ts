import assert from "node:assert/strict";
import test from "node:test";
import { deleteConfirmation } from "./delete-confirmation.ts";

test("one role is named in the singular", () => {
  assert.deepEqual(
    deleteConfirmation(["Acme, Engineer"]),
    {
      confirmLabel: "Delete role",
      description: "This permanently removes this role, including its timeline, actions, saved files, and PDFs.",
      names: ["Acme, Engineer"],
      remainingCount: 0,
      title: "Delete this role?",
    },
  );
});

test("several roles are counted and named", () => {
  const content = deleteConfirmation(["Acme, Engineer", "Globex, Analyst"]);
  assert.equal(content.title, "Delete 2 roles?");
  assert.equal(content.confirmLabel, "Delete 2 roles");
  assert.deepEqual(content.names, ["Acme, Engineer", "Globex, Analyst"]);
  assert.equal(content.remainingCount, 0);
});

test("exactly five are all named", () => {
  const content = deleteConfirmation(["A", "B", "C", "D", "E"]);
  assert.deepEqual(content.names, ["A", "B", "C", "D", "E"]);
  assert.equal(content.remainingCount, 0);
});

test("a long list names five and counts the rest", () => {
  const content = deleteConfirmation(["A", "B", "C", "D", "E", "F", "G"]);
  assert.equal(content.title, "Delete 7 roles?");
  assert.deepEqual(content.names, ["A", "B", "C", "D", "E"]);
  assert.equal(content.remainingCount, 2);
});
