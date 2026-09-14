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
        <Link className="brand" href="/dashboard"><LogoMark /><span>RoleSave</span></Link>
        <DashboardNav />
        <div className="profile">
          <span className="avatar">{initials}</span>
          <span><strong>{viewer.email}</strong><small>Private workspace</small></span>
          <form action={signOut}><button aria-label="Sign out" title="Sign out"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 5H5.75A1.75 1.75 0 0 0 4 6.75v10.5C4 18.22 4.78 19 5.75 19H10M14.5 8l4 4-4 4M8.5 12h10"/></svg></button></form>
        </div>
      </aside>
      {children}
    </div>
  );
}
