"use client";

import { selectableApplicationStatuses } from "@rolesave/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition, type FormEvent } from "react";
import { titleCase } from "@/lib/format";

/**
 * Render with a `key` made from the current filters. The dropdowns only read
 * their starting values, so the key is what makes them follow Clear and the
 * Back button.
 */
export function RoleFilters({ decision, showDecision, status }: {
  decision: string;
  showDecision: boolean;
  status: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const params = new URLSearchParams();
    const nextStatus = form.get("status");
    const nextDecision = form.get("decision");
    if (typeof nextStatus === "string" && nextStatus) params.set("status", nextStatus);
    if (typeof nextDecision === "string" && nextDecision !== "active") params.set("decision", nextDecision);
    const query = params.toString();
    // The filters sit below the fold, so stay here rather than jumping to the top.
    startTransition(() => router.push(query ? `/dashboard?${query}` : "/dashboard", { scroll: false }));
  }

  return (
    // Stops browsers restoring old choices on Back or reload, which would disagree with the page.
    <form autoComplete="off" className="filter-form" onSubmit={applyFilters}>
      <label htmlFor="status-filter">Status</label>
      <select defaultValue={status} id="status-filter" name="status">
        <option value="">All statuses</option>
        {selectableApplicationStatuses.map((item) => <option key={item} value={item}>{titleCase(item)}</option>)}
      </select>
      {showDecision && <>
        <label htmlFor="decision-filter">Decision</label>
        <select defaultValue={decision} id="decision-filter" name="decision">
          <option value="active">Active</option>
          <option value="unreviewed">Not reviewed</option>
          <option value="PURSUE">Pursue</option>
          <option value="MAYBE">Maybe</option>
          <option value="PASS">Pass</option>
          <option value="all">All</option>
        </select>
      </>}
      <button className="secondary-button" disabled={pending} type="submit">{pending ? "Filtering…" : "Filter"}</button>
      {(status || (showDecision && decision !== "active")) && <Link className="text-link" href="/dashboard" scroll={false}>Clear</Link>}
    </form>
  );
}
