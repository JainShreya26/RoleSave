import { redirect } from "next/navigation";
import { ResetPasswordForm } from "./reset-password-form";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage() {
  if (!isSupabaseConfigured()) redirect("/");

  // The recovery link signs the user in; without a session there is nothing to reset.
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) redirect("/auth/forgot-password");

  return (
    <main className="auth-shell">
      <section className="auth-intro">
        <span className="brand auth-brand"><span className="logo-mark" aria-hidden="true"><span /><span /><span /></span>RoleSave</span>
        <p className="eyebrow">Account recovery</p>
        <h1>Choose a new password.</h1>
      </section>
      <div className="auth-card"><ResetPasswordForm /></div>
    </main>
  );
}
