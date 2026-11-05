import Link from "next/link";
import { redirect } from "next/navigation";
import { ForgotPasswordForm } from "./forgot-password-form";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  if (!isSupabaseConfigured()) redirect("/");

  return (
    <main className="auth-shell">
      <section className="auth-intro">
        <span className="brand auth-brand"><span className="logo-mark" aria-hidden="true"><span /><span /><span /></span>RoleSave</span>
        <p className="eyebrow">Account recovery</p>
        <h1>Reset your password.</h1>
        <p>Enter your email and we will send a link to choose a new password.</p>
      </section>
      <div className="auth-card">
        <ForgotPasswordForm />
        <p className="form-message"><Link href="/auth">Back to sign in</Link></p>
      </div>
    </main>
  );
}
