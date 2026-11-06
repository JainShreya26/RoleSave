"use server";

import {
  authCredentialsSchema,
  emailSchema,
  newPasswordSchema,
  safeRedirectPath,
} from "@rolesave/validation";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  alreadyRegisteredMessage,
  awaitingConfirmationMessage,
  classifyRepeatSignUp,
  describeAuthError,
  isRequestRateLimit,
} from "@/lib/auth-errors";
import { siteOrigin } from "@/lib/site-origin";
import { createClient } from "@/lib/supabase/server";

export interface AuthActionState {
  errors?: { email?: string[]; password?: string[]; confirmPassword?: string[] };
  message?: string;
  needsConfirmation?: boolean;
  success?: boolean;
}

export async function authenticate(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = authCredentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const intent = formData.get("intent") === "sign-up" ? "sign-up" : "sign-in";
  const next = safeRedirectPath(formData.get("next"));

  if (intent === "sign-up") {
    const { data, error } = await supabase.auth.signUp({
      ...parsed.data,
      options: { emailRedirectTo: `${await siteOrigin()}${next}` },
    });

    if (error?.code === "user_already_exists") {
      return { message: alreadyRegisteredMessage };
    }

    if (error) {
      return { message: describeAuthError(error, "Could not create the account. Please try again.") };
    }

    const existing = classifyRepeatSignUp(data.user);
    if (existing === "confirmed") {
      return { message: alreadyRegisteredMessage };
    }
    if (existing === "unconfirmed") {
      return { message: awaitingConfirmationMessage, success: true };
    }

    if (!data.session) {
      return {
        message: "Check your email to confirm your address, then sign in.",
        success: true,
      };
    }
  } else {
    const { error } = await supabase.auth.signInWithPassword(parsed.data);
    if (error) {
      if (error.code === "email_not_confirmed") {
        return { message: "Confirm your email address first. Check your inbox for the link.", needsConfirmation: true };
      }
      if (error.status === 429 || error.code?.startsWith("over_")) {
        return { message: describeAuthError(error) };
      }
      return { message: "Email or password is incorrect." };
    }
  }

  revalidatePath("/", "layout");
  redirect(next);
}

export async function resendConfirmation(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = emailSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const next = safeRedirectPath(formData.get("next"));
  const { error } = await supabase.auth.resend({
    email: parsed.data.email,
    options: { emailRedirectTo: `${await siteOrigin()}${next}` },
    type: "signup",
  });

  if (error && isRequestRateLimit(error)) {
    return { message: describeAuthError(error) };
  }

  // Always the same response so account existence is not revealed.
  return {
    message: "If that email still needs confirming, a new link is on its way. If it doesn't arrive in a few minutes, try again.",
    success: true,
  };
}

export async function requestPasswordReset(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = emailSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${await siteOrigin()}/auth/confirm?next=${encodeURIComponent("/auth/reset-password")}`,
  });

  if (error && isRequestRateLimit(error)) {
    return { message: describeAuthError(error) };
  }

  // Always the same response so account existence is not revealed. That includes
  // the limit on repeat emails, which only ever applies to a real account.
  return {
    message: "If an account exists for that email, a reset link is on its way. If it doesn't arrive in a few minutes, try again.",
    success: true,
  };
}

export async function updatePassword(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = newPasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return { message: describeAuthError(error, "The password could not be updated.") };
  }

  // A reset may be how someone takes back their account, so end every other
  // session. The password has already changed, so a failure here does not undo it.
  const { error: signOutError } = await supabase.auth.signOut({ scope: "others" });
  if (signOutError) {
    console.error(`Could not sign out other sessions: ${signOutError.message}`);
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/auth");
}
