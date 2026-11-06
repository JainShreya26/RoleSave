import assert from "node:assert/strict";
import test from "node:test";
import { applicationActionSchema, authCredentialsSchema, captureMetadataSchema, isUuid, newPasswordSchema, selectableApplicationStatusSchema, safeRedirectPath, safeRedirectPathFromLink, createApplicationSchema, triageSchema } from "./index";

test("a person cannot choose the legacy review status", () => {
  assert.equal(selectableApplicationStatusSchema.safeParse("WITHDRAWN").success, true);
  assert.equal(selectableApplicationStatusSchema.safeParse("NEEDS_REVIEW").success, false);
});

test("action validation explains itself in plain words", () => {
  const dates = { dueAt: "2026-09-18T09:00:00.000Z", remindAt: null };
  const message = (input: unknown) => {
    const result = applicationActionSchema.safeParse(input);
    return result.success ? null : result.error.issues[0]?.message;
  };
  assert.equal(message({ ...dates, title: "   " }), "Enter what needs doing");
  assert.equal(message({ ...dates, title: null }), "Enter what needs doing");
  assert.equal(message({ ...dates, title: "x".repeat(201) }), "Keep the action to 200 characters or fewer");
  assert.equal(message({ title: "Follow up", dueAt: "", remindAt: null }), "Choose a due date");
  assert.equal(message({ ...dates, title: "x".repeat(200) }), null);
});

test("recognizes values shaped like a UUID", () => {
  assert.equal(isUuid("b7930d1c-a99d-469f-8f24-80d871e92d23"), true);
  assert.equal(isUuid("B7930D1C-A99D-469F-8F24-80D871E92D23"), true);
  // Not a standard version, but the database accepts it, so it could be a real ID.
  assert.equal(isUuid("dddddddd-0000-0000-0000-000000000002"), true);
  assert.equal(isUuid("not-a-uuid"), false);
  assert.equal(isUuid(""), false);
  assert.equal(isUuid("b7930d1c-a99d-469f-8f24-80d871e92d23x"), false);
});

test("validates and normalizes auth credentials", () => {
  const result = authCredentialsSchema.parse({ email: "  USER@Example.com ", password: "password123" });
  assert.equal(result.email, "user@example.com");
});

test("normalizes application input and supplies the manual source", () => {
  const result = createApplicationSchema.parse({ company: "  Google  ", position: " Engineer " });
  assert.equal(result.company, "Google");
  assert.equal(result.position, "Engineer");
  assert.equal(result.source, "MANUAL");
});

test("rejects non-web capture URLs", () => {
  const result = captureMetadataSchema.safeParse({
    company: "Example", position: "Engineer", originalUrl: "file:///private/job.html", capturedAt: new Date().toISOString(),
  });
  assert.equal(result.success, false);
});

test("reminder time cannot come after its action is due", () => {
  const result = applicationActionSchema.safeParse({
    title: "Follow up",
    dueAt: "2026-09-18T09:00:00.000Z",
    remindAt: "2026-09-18T10:00:00.000Z",
  });
  assert.equal(result.success, false);
});

test("saved-role decisions have a bounded reason", () => {
  assert.equal(triageSchema.safeParse({ decision: "PURSUE", reason: "Good fit" }).success, true);
  assert.equal(triageSchema.safeParse({ decision: "PASS", reason: "x".repeat(501) }).success, false);
});

test("application errors say what to fix", () => {
  const errors = (input: Record<string, unknown>) =>
    createApplicationSchema.safeParse({ company: "Acme", position: "Engineer", ...input }).error?.flatten().fieldErrors;
  assert.deepEqual(errors({ company: "   " })?.company, ["Enter the company name"]);
  assert.deepEqual(errors({ company: "c".repeat(201) })?.company, ["Keep the company name to 200 characters or fewer"]);
  assert.deepEqual(errors({ position: "" })?.position, ["Enter the position"]);
  assert.deepEqual(errors({ position: "p".repeat(301) })?.position, ["Keep the position to 300 characters or fewer"]);
  assert.deepEqual(errors({ jobId: "j".repeat(201) })?.jobId, ["Keep the job ID to 200 characters or fewer"]);
  for (const originalUrl of ["ftp://example.com/job", "javascript:alert(1)", "not a url"]) {
    assert.match(errors({ originalUrl })?.originalUrl?.[0] ?? "", /starting with http/);
  }
});

test("an applied date must be an exact moment", () => {
  const applied = (appliedAt: string) => createApplicationSchema.safeParse({ appliedAt, company: "Acme", position: "Engineer" });
  assert.equal(applied("2026-10-15T14:30:00.000Z").success, true);
  assert.equal(applied("2026-10-15T23:30:00+09:00").success, true);
  // With no zone, the server would have to guess whose 23:30 this is.
  assert.deepEqual(applied("2026-10-15T23:30").error?.flatten().fieldErrors.appliedAt, ["Enter a valid date and time"]);
});

test("an applied date cannot be in the future", () => {
  const applied = (appliedAt: string) => createApplicationSchema.safeParse({ appliedAt, company: "Acme", position: "Engineer" });
  const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60 * 1_000).toISOString();
  assert.equal(applied(inMinutes(-60)).success, true);
  assert.equal(applied(inMinutes(2)).success, true, "a slightly fast clock is fine");
  assert.deepEqual(applied(inMinutes(60)).error?.flatten().fieldErrors.appliedAt, ["The applied date can't be in the future"]);
  assert.deepEqual(applied("2030-01-01T09:00:00.000Z").error?.flatten().fieldErrors.appliedAt, ["The applied date can't be in the future"]);
});

test("safeRedirectPath only allows same-origin app paths", () => {
  assert.equal(safeRedirectPath("/dashboard/actions?x=1"), "/dashboard/actions?x=1");
  for (const bad of ["https://evil.com", "//evil.com", "/\\evil.com", "javascript:alert(1)", "/auth", "/auth/confirm", "", null, undefined, "/a\nb"]) {
    assert.equal(safeRedirectPath(bad), "/dashboard");
  }
});

test("safeRedirectPathFromLink only accepts URLs on the given origin", () => {
  const origin = "https://app.example.com";
  assert.equal(safeRedirectPathFromLink(`${origin}/dashboard/actions?x=1`, origin), "/dashboard/actions?x=1");
  assert.equal(safeRedirectPathFromLink("/dashboard/actions", origin), "/dashboard/actions");
  for (const bad of [origin, `${origin}.evil.com/x`, `${origin}//evil.com`, `${origin}/auth/reset-password`, "https://evil.com/x", null]) {
    assert.equal(safeRedirectPathFromLink(bad, origin), "/dashboard");
  }
});

test("new password requires a match and minimum length", () => {
  assert.equal(newPasswordSchema.safeParse({ password: "password123", confirmPassword: "password123" }).success, true);
  assert.equal(newPasswordSchema.safeParse({ password: "password123", confirmPassword: "other" }).success, false);
  assert.equal(newPasswordSchema.safeParse({ password: "short", confirmPassword: "short" }).success, false);
});
