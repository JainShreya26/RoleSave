import { safeRedirectPath } from "@rolesave/validation";
import { redirect } from "next/navigation";
import { BrandLogo } from "@/app/brand-logo";
import { AuthForm } from "./auth-form";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AuthPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const params = await searchParams;
  if (!isSupabaseConfigured()) {
    redirect("/");
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (data?.claims?.sub) {
    redirect("/dashboard");
  }

  return (
    <main className="auth-shell">
      <section className="auth-intro">
        <span className="auth-brand"><BrandLogo className="auth-brand-logo" preload sizes="210px" /></span>
        <p className="eyebrow">Your private job-search record</p>
        <h1>Keep the details. Lose the spreadsheet.</h1>
        <p>RoleSave brings applications and saved job descriptions into one clear timeline.</p>
      </section>
      <AuthForm
        linkError={params.error === "link"}
        next={safeRedirectPath(params.next)}
      />
    </main>
  );
}
