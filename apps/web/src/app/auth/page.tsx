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
        <span className="brand auth-brand"><span className="logo-mark" aria-hidden="true"><span /><span /><span /></span>Ledger</span>
        <p className="eyebrow">Private application tracking</p>
        <h1>Your job search, recorded automatically.</h1>
        <p>Sign in to view applications, evidence, and saved job descriptions protected by your account.</p>
      </section>
      <AuthForm />
    </main>
  );
}
