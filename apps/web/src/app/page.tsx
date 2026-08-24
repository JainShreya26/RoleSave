import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    redirect(data?.claims?.sub ? "/dashboard" : "/auth");
  }

  return (
    <main className="setup-shell">
      <section className="setup-card">
        <span className="brand setup-brand"><span className="logo-mark" aria-hidden="true"><span /><span /><span /></span>Ledger</span>
        <p className="eyebrow">One local prerequisite remains</p>
        <h1>Connect the local Supabase backend</h1>
        <p>The authenticated tracker is implemented. Start the local Supabase containers and add the generated project URL and publishable or anonymous key to <code>.env.local</code>.</p>
        <ol>
          <li>Install and start Docker Desktop, OrbStack, Colima, Podman, or Rancher Desktop.</li>
          <li>Run <code>pnpm supabase:start</code> from the repository root.</li>
          <li>Copy <code>.env.example</code> to <code>.env.local</code> and replace the placeholder values.</li>
          <li>Restart <code>pnpm dev:web</code>.</li>
        </ol>
        <p className="setup-note">The service-role key is only for the future worker. Never place it in browser or extension code.</p>
      </section>
    </main>
  );
}
