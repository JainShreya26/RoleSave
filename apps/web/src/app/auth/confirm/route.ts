import type { EmailOtpType } from "@supabase/supabase-js";
import { safeRedirectPathFromLink } from "@rolesave/validation";
import { NextResponse, type NextRequest } from "next/server";
import { siteOrigin } from "@/lib/site-origin";
import { createClient } from "@/lib/supabase/server";

const emailOtpTypes = new Set<EmailOtpType>(["signup", "invite", "magiclink", "recovery", "email_change", "email"]);

/**
 * Landing point for links in Supabase auth emails (sign-up confirmation and
 * password recovery). Exchanges the token for a session, then redirects.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const origin = await siteOrigin();
  const next = safeRedirectPathFromLink(searchParams.get("next"), origin);

  if (tokenHash && type && emailOtpTypes.has(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) {
      const destination = type === "recovery" ? "/auth/reset-password" : next;
      return NextResponse.redirect(new URL(destination, origin));
    }
  }

  return NextResponse.redirect(new URL("/auth?error=link", origin));
}
