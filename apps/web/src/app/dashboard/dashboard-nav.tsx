"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { actionsChangedEvent, actionTiming } from "@/lib/action-timing";
import { capturesChangedEvent } from "@/lib/failed-job-features";
import { createClient } from "@/lib/supabase/client";
import { fetchAllRows } from "@/lib/supabase/fetch-all";

export function DashboardNav() {
  const pathname = usePathname();
  const applicationsActive = pathname === "/dashboard" || pathname.startsWith("/dashboard/applications");
  const actionsActive = pathname.startsWith("/dashboard/actions");
  const operationsActive = pathname.startsWith("/dashboard/operations");
  const [attentionCount, setAttentionCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    async function refreshCount() {
      const [actions, failed] = await Promise.all([
        fetchAllRows((from, to) => supabase.from("application_actions")
          .select("application_id,due_at,remind_at")
          .is("completed_at", null)
          .order("id")
          .range(from, to)),
        supabase.from("capture_jobs").select("id", { count: "exact", head: true }).eq("status", "FAILED"),
      ]);
      if (!active) return;
      const now = new Date();
      if (!actions.error) setAttentionCount(actions.data.filter((item) => actionTiming(item, now) !== "upcoming").length);
      if (!failed.error) setFailedCount(failed.count ?? 0);
    }
    void refreshCount();
    const interval = window.setInterval(() => void refreshCount(), 30_000);
    const onVisibility = () => { if (!document.hidden) void refreshCount(); };
    const onActionsChanged = () => void refreshCount();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener(actionsChangedEvent, onActionsChanged);
    window.addEventListener(capturesChangedEvent, onActionsChanged);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener(actionsChangedEvent, onActionsChanged);
      window.removeEventListener(capturesChangedEvent, onActionsChanged);
    };
  }, [pathname]);

  return (
    <nav aria-label="Main navigation" className="nav-list">
      <Link
        aria-current={applicationsActive ? "page" : undefined}
        className={`nav-item ${applicationsActive ? "active" : ""}`}
        href="/dashboard"
      >
        <svg className="nav-glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4.75h14A1.25 1.25 0 0 1 20.25 6v12A1.25 1.25 0 0 1 19 19.25H5A1.25 1.25 0 0 1 3.75 18V6A1.25 1.25 0 0 1 5 4.75Z"/><path d="M8 9h8M8 13h5"/></svg>
        <span>Roles</span>
      </Link>
      <Link aria-current={actionsActive ? "page" : undefined} aria-label={attentionCount ? `Actions, ${attentionCount} need attention` : "Actions"} className={`nav-item ${actionsActive ? "active" : ""}`} href="/dashboard/actions">
        <svg className="nav-glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14M5 12h14M5 18h14M8 4v4M8 10v4M8 16v4"/></svg>
        <span>Actions</span>
        {attentionCount > 0 && <span className="nav-count" aria-hidden="true">{attentionCount}</span>}
      </Link>
      {/* Only shown when a save needs attention, or while that page is open. */}
      {(failedCount > 0 || operationsActive) && (
        <Link aria-current={operationsActive ? "page" : undefined} aria-label={failedCount ? `Processing issues, ${failedCount} failed` : "Processing issues"} className={`nav-item ${operationsActive ? "active" : ""}`} href="/dashboard/operations">
          <svg className="nav-glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.5 3.75 19h16.5L12 4.5Z"/><path d="M12 10v4M12 16.5v.25"/></svg>
          <span>Processing issues</span>
          {failedCount > 0 && <span className="nav-count" aria-hidden="true">{failedCount}</span>}
        </Link>
      )}
    </nav>
  );
}
