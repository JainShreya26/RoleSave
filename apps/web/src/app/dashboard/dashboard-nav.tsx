"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { actionTiming } from "@/lib/action-timing";
import { createClient } from "@/lib/supabase/client";
import { fetchAllRows } from "@/lib/supabase/fetch-all";

export function DashboardNav() {
  const pathname = usePathname();
  const applicationsActive = pathname === "/dashboard" || pathname.startsWith("/dashboard/applications");
  const actionsActive = pathname.startsWith("/dashboard/actions");
  const [attentionCount, setAttentionCount] = useState(0);

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    async function refreshCount() {
      const { data, error } = await fetchAllRows((from, to) => supabase.from("application_actions")
        .select("application_id,due_at,remind_at")
        .is("completed_at", null)
        .order("id")
        .range(from, to));
      if (error || !active) return;
      const { data: passedRoles, error: passedError } = await fetchAllRows((from, to) => supabase.from("applications")
        .select("id").eq("status", "SAVED").eq("triage_decision", "PASS")
        .order("id")
        .range(from, to));
      if (passedError || !active) return;
      const passedIds = new Set(passedRoles.map((item) => item.id));
      const now = new Date();
      setAttentionCount(data.filter((item) => !passedIds.has(item.application_id) && actionTiming(item, now) !== "upcoming").length);
    }
    void refreshCount();
    const interval = window.setInterval(() => void refreshCount(), 30_000);
    const onVisibility = () => { if (!document.hidden) void refreshCount(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
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
        <span>Applications</span>
      </Link>
      <Link aria-current={actionsActive ? "page" : undefined} aria-label={attentionCount ? `Actions, ${attentionCount} need attention` : "Actions"} className={`nav-item ${actionsActive ? "active" : ""}`} href="/dashboard/actions">
        <svg className="nav-glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14M5 12h14M5 18h14M8 4v4M8 10v4M8 16v4"/></svg>
        <span>Actions</span>
        {attentionCount > 0 && <span className="nav-count" aria-hidden="true">{attentionCount}</span>}
      </Link>
    </nav>
  );
}
