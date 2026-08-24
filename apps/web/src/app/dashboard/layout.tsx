import Link from "next/link";
import { signOut } from "@/app/auth/actions";
import { DashboardNav } from "./dashboard-nav";
import { requireViewer } from "@/lib/auth";

function LogoMark() {
  return <span className="logo-mark" aria-hidden="true"><span /><span /><span /></span>;
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { viewer } = await requireViewer();
  const initials = viewer.email === "Signed-in user" ? "U" : viewer.email.slice(0, 2).toUpperCase();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/dashboard"><LogoMark /><span>Ledger</span></Link>
        <DashboardNav />
        <div className="sidebar-card">
          <p className="sidebar-card-label">Private workspace</p>
          <p>Database access is scoped to your verified Supabase account.</p>
          <span className="connection-state"><i /> RLS protected</span>
        </div>
        <div className="profile">
          <span className="avatar">{initials}</span>
          <span><strong>{viewer.email}</strong><small>Authenticated</small></span>
          <form action={signOut}><button aria-label="Sign out" title="Sign out">↪</button></form>
        </div>
      </aside>
      {children}
    </div>
  );
}
