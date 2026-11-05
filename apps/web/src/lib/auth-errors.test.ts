import assert from "node:assert/strict";
import test from "node:test";
import { classifyRepeatSignUp, describeAuthError, isRequestRateLimit } from "./auth-errors.ts";

test("maps known Supabase auth error codes to friendly messages", () => {
  assert.match(describeAuthError({ code: "weak_password" }), /too weak/);
  assert.match(describeAuthError({ code: "over_email_send_rate_limit" }), /Too many attempts/);
  assert.match(describeAuthError({ code: "otp_expired" }), /expired/);
  assert.match(describeAuthError({ code: "same_password" }), /different/);
});

test("treats any 429 as rate limiting", () => {
  assert.match(describeAuthError({ status: 429 }), /Too many attempts/);
});

test("never leaks raw error text for unknown codes", () => {
  assert.equal(describeAuthError({ code: "unexpected_failure", status: 500 }, "Custom fallback."), "Custom fallback.");
  assert.equal(describeAuthError({}), "Something went wrong. Please try again.");
});

test("recognizes repeat sign-ups that Supabase reports as success", () => {
  const created_at = "2026-11-05T03:04:14.935Z";
  assert.equal(classifyRepeatSignUp({ created_at, identities: [] }), "confirmed");
  assert.equal(
    classifyRepeatSignUp({ confirmation_sent_at: "2026-11-05T04:00:00.000Z", created_at, identities: [{}] }),
    "unconfirmed",
  );
});

test("does not flag a brand-new sign-up as a repeat", () => {
  assert.equal(
    classifyRepeatSignUp({ confirmation_sent_at: "2026-11-05T03:04:14.941Z", created_at: "2026-11-05T03:04:14.935Z", identities: [{}] }),
    null,
  );
  assert.equal(classifyRepeatSignUp(null), null);
});

test("only a limit on requests may be shown without revealing an account", () => {
  assert.equal(isRequestRateLimit({ code: "over_request_rate_limit", status: 429 }), true);
  assert.equal(isRequestRateLimit({ code: "over_email_send_rate_limit", status: 429 }), false);
  assert.equal(isRequestRateLimit({ status: 429 }), false);
  assert.equal(isRequestRateLimit({ code: "email_address_invalid", status: 400 }), false);
});
