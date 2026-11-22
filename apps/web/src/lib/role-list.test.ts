import assert from "node:assert/strict";
import test from "node:test";
import { countActiveRoles, countByStatus, defaultRoleSort, formatRoleSort, nextRoleSort, parseRoleSort, parseStatusFilter, searchRoles, sortRoles, statusTone } from "./role-list.ts";

function role(id: string, overrides: Partial<Parameters<typeof sortRoles>[0][number]> = {}) {
  return {
    applied_at: null,
    company: "Acme",
    id,
    position: "Engineer",
    status: "APPLIED" as const,
    updated_at: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

const ids = (roles: { id: string }[]) => roles.map((item) => item.id);

test("only a status a person can choose is a filter", () => {
  assert.equal(parseStatusFilter("INTERVIEW"), "INTERVIEW");
  assert.equal(parseStatusFilter("NEEDS_REVIEW"), null);
  assert.equal(parseStatusFilter("interview"), null);
  assert.equal(parseStatusFilter(null), null);
});

test("a sort survives the page address, and a bad one falls back to the default", () => {
  assert.deepEqual(parseRoleSort(formatRoleSort({ direction: "asc", key: "company" })), { direction: "asc", key: "company" });
  assert.equal(formatRoleSort(defaultRoleSort), null);
  for (const value of [null, "", "company", "company-up", "constructor-asc", "toString-desc"]) {
    assert.deepEqual(parseRoleSort(value), defaultRoleSort);
  }
});

test("the current column reverses and a new column starts in its usual direction", () => {
  assert.deepEqual(nextRoleSort(defaultRoleSort, "updated"), { direction: "asc", key: "updated" });
  assert.deepEqual(nextRoleSort(defaultRoleSort, "company"), { direction: "asc", key: "company" });
  assert.deepEqual(nextRoleSort({ direction: "asc", key: "company" }, "applied"), { direction: "desc", key: "applied" });
});

test("search matches every word across company and position", () => {
  const roles = [
    role("stripe", { company: "Stripe", position: "Senior Product Engineer" }),
    role("linear", { company: "Linear", position: "Frontend Engineer" }),
    role("nestle", { company: "Nestlé", position: "Data Analyst" }),
  ];
  assert.deepEqual(ids(searchRoles(roles, "  ")), ["stripe", "linear", "nestle"]);
  assert.deepEqual(ids(searchRoles(roles, "engineer senior")), ["stripe"]);
  assert.deepEqual(ids(searchRoles(roles, "LINEAR front")), ["linear"]);
  assert.deepEqual(ids(searchRoles(roles, "nestle")), ["nestle"]);
  assert.deepEqual(ids(searchRoles(roles, "stripe frontend")), []);
});

test("counts are by status", () => {
  const counts = countByStatus([{ status: "SAVED" }, { status: "SAVED" }, { status: "OFFER" }]);
  assert.equal(counts.get("SAVED"), 2);
  assert.equal(counts.get("OFFER"), 1);
  assert.equal(counts.get("APPLIED"), undefined);
});

test("roles with no applied date stay last in both directions", () => {
  const roles = [
    role("none"),
    role("old", { applied_at: "2026-01-01T00:00:00.000Z" }),
    role("new", { applied_at: "2026-06-01T00:00:00.000Z" }),
  ];
  assert.deepEqual(ids(sortRoles(roles, { direction: "desc", key: "applied" })), ["new", "old", "none"]);
  assert.deepEqual(ids(sortRoles(roles, { direction: "asc", key: "applied" })), ["old", "new", "none"]);
});

test("statuses sort in pipeline order, with a legacy status last", () => {
  const roles = [
    role("legacy", { status: "NEEDS_REVIEW" }),
    role("offer", { status: "OFFER" }),
    role("saved", { status: "SAVED" }),
    role("interview", { status: "INTERVIEW" }),
  ];
  assert.deepEqual(ids(sortRoles(roles, { direction: "asc", key: "status" })), ["saved", "interview", "offer", "legacy"]);
});

test("companies sort without regard to case, and ties go to the newest update", () => {
  const roles = [
    role("zeta", { company: "zeta" }),
    role("alpha-old", { company: "Alpha", updated_at: "2026-01-01T00:00:00.000Z" }),
    role("alpha-new", { company: "alpha", updated_at: "2026-06-01T00:00:00.000Z" }),
  ];
  assert.deepEqual(ids(sortRoles(roles, { direction: "asc", key: "company" })), ["alpha-new", "alpha-old", "zeta"]);
  assert.deepEqual(ids(sortRoles(roles, { direction: "desc", key: "company" })), ["zeta", "alpha-new", "alpha-old"]);
});

test("sorting leaves the original list alone", () => {
  const roles = [role("a", { updated_at: "2026-01-01T00:00:00.000Z" }), role("b", { updated_at: "2026-06-01T00:00:00.000Z" })];
  sortRoles(roles, defaultRoleSort);
  assert.deepEqual(ids(roles), ["a", "b"]);
});

test("roles in progress are the ones applied to and still undecided", () => {
  const statuses = ["SAVED", "APPLIED", "ASSESSMENT", "INTERVIEW", "OFFER", "REJECTED", "WITHDRAWN"] as const;
  assert.equal(countActiveRoles(statuses.map((status) => ({ status }))), 3);
  assert.equal(countActiveRoles([]), 0);
});

test("every status has a colour, and the table and the role page share it", () => {
  assert.equal(statusTone("INTERVIEW"), "green");
  assert.equal(statusTone("REJECTED"), "rose");
  assert.equal(statusTone("SAVED"), "neutral");
});
