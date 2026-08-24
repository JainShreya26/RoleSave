"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function DashboardNav() {
  const pathname = usePathname();
  const emailActive = pathname.startsWith("/dashboard/email");
  const reviewActive = pathname.startsWith("/dashboard/review");
  const applicationsActive = !emailActive && !reviewActive;

  return (
    <nav aria-label="Main navigation" className="nav-list">
      <Link
        aria-current={applicationsActive ? "page" : undefined}
        className={`nav-item ${applicationsActive ? "active" : ""}`}
        href="/dashboard"
      >
        <span className="nav-glyph">⌂</span>Applications
      </Link>
      <Link
        aria-current={reviewActive ? "page" : undefined}
        className={`nav-item ${reviewActive ? "active" : ""}`}
        href="/dashboard/review"
      >
        <span className="nav-glyph">◇</span>Needs review
      </Link>
      <Link
        aria-current={emailActive ? "page" : undefined}
        className={`nav-item ${emailActive ? "active" : ""}`}
        href="/dashboard/email"
      >
        <span className="nav-glyph">@</span>Email connection
      </Link>
    </nav>
  );
}
