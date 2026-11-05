interface AuthErrorLike {
  code?: string;
  status?: number;
}

/** Maps Supabase auth errors to messages that are safe and useful to show. */
export function describeAuthError(error: AuthErrorLike, fallback = "Something went wrong. Please try again."): string {
  switch (error.code) {
    case "weak_password":
      return "That password is too weak. Use at least 8 characters.";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
    case "over_sms_send_rate_limit":
      return "Too many attempts. Please wait a few minutes and try again.";
    case "signup_disabled":
    case "email_provider_disabled":
      return "Sign-ups are currently disabled.";
    case "email_address_invalid":
      return "Enter a valid email address.";
    case "same_password":
      return "Choose a password different from your current one.";
    case "otp_expired":
    case "flow_state_expired":
      return "That link has expired. Request a new one.";
    case "session_not_found":
    case "refresh_token_not_found":
      return "Your session has expired. Please sign in again.";
    default:
      return error.status === 429 ? "Too many attempts. Please wait a few minutes and try again." : fallback;
  }
}

/**
 * True when too many requests came from one address. The separate limit on
 * repeat emails only applies to real accounts, so showing it would reveal
 * whether an account exists.
 */
export function isRequestRateLimit(error: AuthErrorLike): boolean {
  return error.code === "over_request_rate_limit";
}

export const alreadyRegisteredMessage = "This email is already registered. Please sign in instead.";
export const awaitingConfirmationMessage =
  "This email is already registered but not confirmed yet. We sent a new confirmation link.";

interface SignUpUserLike {
  confirmation_sent_at?: string;
  created_at?: string;
  identities?: unknown[] | null;
}

/** A first sign-up sends its email within moments of creating the user. */
const firstSignUpWindowMs = 60_000;

/**
 * Supabase reports some repeat sign-ups as a normal success, so they have to be
 * recognized from the returned user:
 * - An empty `identities` list stands in for an already confirmed account.
 * - A confirmation sent well after `created_at` means an unconfirmed account
 *   was signed up again, and Supabase has resent its confirmation email.
 */
export function classifyRepeatSignUp(user: SignUpUserLike | null | undefined): "confirmed" | "unconfirmed" | null {
  if (!user) return null;
  if (Array.isArray(user.identities) && user.identities.length === 0) return "confirmed";
  if (!user.created_at || !user.confirmation_sent_at) return null;
  const elapsed = Date.parse(user.confirmation_sent_at) - Date.parse(user.created_at);
  return elapsed > firstSignUpWindowMs ? "unconfirmed" : null;
}
