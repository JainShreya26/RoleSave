"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function DashboardNav() {
  const pathname = usePathname();
  const emailActivityActive = pathname.startsWith("/dashboard/email/activity");
  const emailConnectionActive = pathname === "/dashboard/email";
  const reviewActive = pathname.startsWith("/dashboard/review");
  const applicationsActive = pathname === "/dashboard" || pathname.startsWith("/dashboard/applications");

  return (
    <nav aria-label="Main navigation" className="nav-list">
      <Link
        aria-current={applicationsActive ? "page" : undefined}
        className={`nav-item ${applicationsActive ? "active" : ""}`}
        href="/dashboard"
      >
        <svg className="nav-glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4.75h14A1.25 1.25 0 0 1 20.25 6v12A1.25 1.25 0 0 1 19 19.25H5A1.25 1.25 0 0 1 3.75 18V6A1.25 1.25 0 0 1 5 4.75Z"/><path d="M8 9h8M8 13h5"/></svg>
        <span>Applications</span>
      </Link>
      <Link
        aria-current={reviewActive ? "page" : undefined}
        className={`nav-item ${reviewActive ? "active" : ""}`}
        href="/dashboard/review"
      >
        <svg className="nav-glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.75 20.25 8v8L12 20.25 3.75 16V8L12 3.75Z"/><path d="m8.5 12 2.25 2.25L15.5 9.5"/></svg>
        <span>Needs review</span>
      </Link>
      <Link
        aria-current={emailActivityActive ? "page" : undefined}
        className={`nav-item ${emailActivityActive ? "active" : ""}`}
        href="/dashboard/email/activity"
      >
        <svg className="nav-glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.75 6.75h14.5v10.5H4.75z"/><path d="m5.5 7.5 6.5 5 6.5-5"/></svg>
        <span>Email activity</span>
      </Link>
      <Link
        aria-current={emailConnectionActive ? "page" : undefined}
        className={`nav-item ${emailConnectionActive ? "active" : ""}`}
        href="/dashboard/email"
      >
        <svg className="nav-glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 8.25a4.75 4.75 0 0 1 7 0l.25.25a4.75 4.75 0 0 1 0 7l-.75.75"/><path d="M15.5 15.75a4.75 4.75 0 0 1-7 0l-.25-.25a4.75 4.75 0 0 1 0-7L9 7.75M9.5 14.5l5-5"/></svg>
        <span>Email setup</span>
      </Link>
    </nav>
  );
}
