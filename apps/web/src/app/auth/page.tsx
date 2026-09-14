import { redirect } from "next/navigation";
import { AuthForm } from "./auth-form";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AuthPage() {
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
        <span className="brand auth-brand"><span className="logo-mark" aria-hidden="true"><span /><span /><span /></span>RoleSave</span>
        <p className="eyebrow">Your private job-search record</p>
        <h1>Keep the details. Lose the spreadsheet.</h1>
        <p>RoleSave brings applications, recruiting emails, and saved job descriptions into one clear timeline.</p>
      </section>
      <AuthForm />
    </main>
  );
}
