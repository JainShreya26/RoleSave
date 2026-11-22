"use client";

import { selectableApplicationStatuses, type ApplicationStatus } from "@rolesave/types";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { startTransition, useEffect, useOptimistic, useRef, useState, type ReactNode } from "react";
import { formatDateTime, timeAgo, titleCase } from "@/lib/format";
import { countByStatus, formatRoleSort, nextRoleSort, parseRoleSort, parseStatusFilter, searchRoles, sortRoles, statusTone, type RoleListItem, type RoleSort, type RoleSortKey } from "@/lib/role-list";
import { changeStatusAction, refreshDashboardAction } from "./actions";
import { ApplicationCreateForm } from "./application-create-form";
import { LocalDate, useCurrentMinute, useViewerTimeZone } from "./local-date";
import { DeleteResult, DockNotice, ExportResult, ExportRoles, RoleCheckbox, RoleSelection, SelectAllRoles, SelectionBar } from "./role-selection";

// Long lists draw in steps, so the page stays quick however many roles there are.
const pageSize = 100;
const processingRefresh = 15_000;
const returnRefreshGap = 30_000;

const sortChoices: { label: string; value: string }[] = [
  { label: "Recently updated", value: "updated-desc" },
  { label: "Least recently updated", value: "updated-asc" },
  { label: "Company, A to Z", value: "company-asc" },
  { label: "Company, Z to A", value: "company-desc" },
  { label: "Recently applied", value: "applied-desc" },
  { label: "Earliest applied", value: "applied-asc" },
  { label: "Status, first to last", value: "status-asc" },
  { label: "Status, last to first", value: "status-desc" },
];

interface StatusChange {
  at: string;
  id: string;
  restoreAppliedAt: string | null;
  status: ApplicationStatus;
}

interface Notice {
  key: string;
  roleId: string;
  text: string;
  tone: "error" | "success";
  undo?: () => void;
}

function roleCount(count: number) {
  return `${count.toLocaleString("en-US")} ${count === 1 ? "role" : "roles"}`;
}

/** Shows the same result the server will reach, so the row is right before it answers. */
function applyStatusChange(roles: RoleListItem[], change: StatusChange) {
  return roles.map((role) => role.id !== change.id ? role : {
    ...role,
    applied_at: change.status === "SAVED" ? null : role.applied_at ?? change.restoreAppliedAt ?? change.at,
    status: change.status,
    updated_at: change.at,
  });
}

// A Server Action, because router.refresh() with no connection leaves the page
// for the browser's error screen. This just fails, and a later refresh catches up.
function refreshQuietly() {
  startTransition(async () => {
    try {
      await refreshDashboardAction();
    } catch {
      // Nothing was changed, so the page can stay as it is.
    }
  });
}

function viewAddress(search: string, changes: Record<string, string | null>) {
  const next = new URLSearchParams(search);
  for (const [name, value] of Object.entries(changes)) {
    if (value) next.set(name, value);
    else next.delete(name);
  }
  const text = next.toString();
  return text ? `/dashboard?${text}` : "/dashboard";
}

function StatusTab({ active, count, href, label, onSelect }: {
  active: boolean;
  count: number;
  href: string;
  label: string;
  onSelect: () => void;
}) {
  return (
    <Link
      aria-current={active ? "true" : undefined}
      className={`status-tab ${active ? "active" : ""} ${count === 0 ? "empty" : ""}`}
      href={href}
      onClick={(event) => {
        // A click that opens a new tab stays with the browser.
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onSelect();
      }}
      scroll={false}
    >
      <span>{label}</span>
      <b>{count.toLocaleString("en-US")}</b>
    </Link>
  );
}

function SortButton({ label, onSort, sort, sortKey }: {
  label: string;
  onSort: (key: RoleSortKey) => void;
  sort: RoleSort;
  sortKey: RoleSortKey;
}) {
  const active = sort.key === sortKey;
  return (
    <button className={`sort-button ${active ? "active" : ""}`} onClick={() => onSort(sortKey)} type="button">
      <span>{label}</span>
      <i aria-hidden="true">{active ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}</i>
    </button>
  );
}

function ariaSort(sort: RoleSort, key: RoleSortKey) {
  if (sort.key !== key) return "none";
  return sort.direction === "asc" ? "ascending" : "descending";
}

function StatusSelect({ onChange, role }: { onChange: (status: ApplicationStatus) => void; role: RoleListItem }) {
  const selectable = selectableApplicationStatuses.some((item) => item === role.status);
  return (
    <span className={`status status-select ${statusTone(role.status)}`}>
      <i />
      <select
        aria-label={`Status for ${role.company}, ${role.position}`}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value as ApplicationStatus)}
        value={role.status}
      >
        {!selectable && <option disabled value={role.status}>{titleCase(role.status)}</option>}
        {selectableApplicationStatuses.map((item) => <option key={item} value={item}>{titleCase(item)}</option>)}
      </select>
    </span>
  );
}

function DocumentCell({ role }: { role: RoleListItem }) {
  if (role.document_status === "COMPLETE" && role.document_id) {
    return <a className="document-link" href={`/dashboard/applications/${role.id}/documents/${role.document_id}`} rel="noreferrer" target="_blank">Open PDF <span aria-hidden="true">↗</span></a>;
  }
  if (role.document_status === "FAILED") {
    return <Link className="document-link failed" href={`/dashboard/applications/${role.id}`}>Failed, retry</Link>;
  }
  if (role.document_status) return <span className="document-state processing"><i aria-hidden="true" />Saving PDF</span>;
  return <span className="document-state">Not saved</span>;
}

function RoleRow({ changed, now, onStatusChange, role, timeZone }: {
  changed: boolean;
  now: number;
  onStatusChange: (role: RoleListItem, status: ApplicationStatus) => void;
  role: RoleListItem;
  timeZone: string;
}) {
  return (
    <tr className={changed ? "just-changed" : undefined} role="row">
      <td role="cell">
        <div className="role-cell">
          <RoleCheckbox id={role.id} name={`${role.company}, ${role.position}`} />
          <span aria-hidden="true" className="company-mark">{role.company.slice(0, 1).toUpperCase()}</span>
          <div className="role-name">
            {/* The posting link sits beside the name it belongs to, where an "open elsewhere" icon is expected. */}
            <span className="role-name-line">
              <Link aria-label={`${role.company}, ${role.position}`} className="application-name" href={`/dashboard/applications/${role.id}`}>{role.company}</Link>
              {role.original_url && (
                <a aria-label={`Open the ${role.company} job posting`} className="posting-link" href={role.original_url} rel="noreferrer" target="_blank" title="Open job posting">
                  <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M14 5h5v5M19 5l-8.5 8.5M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4" /></svg>
                </a>
              )}
            </span>
            <small>{role.position}</small>
          </div>
        </div>
      </td>
      <td data-label="Status" role="cell"><StatusSelect onChange={(status) => onStatusChange(role, status)} role={role} /></td>
      <td data-label="Applied" role="cell">
        {role.applied_at
          ? <span className="date-stack"><LocalDate value={role.applied_at} /><small>{timeAgo(role.applied_at, now)}</small></span>
          : <span className="date-none">{role.status === "SAVED" ? "Not yet" : "Not recorded"}</span>}
      </td>
      <td data-label="Job description" role="cell"><DocumentCell role={role} /></td>
      <td data-label="Updated" role="cell">
        <time className="updated-at" dateTime={role.updated_at} title={formatDateTime(role.updated_at, undefined, timeZone)}>{timeAgo(role.updated_at, now)}</time>
      </td>
    </tr>
  );
}

function PanelEmptyState({ action, children, title }: { action: ReactNode; children: ReactNode; title: string }) {
  return <div className="empty-state"><span aria-hidden="true">▤</span><h2>{title}</h2><p>{children}</p><div className="empty-state-action">{action}</div></div>;
}

export function RolesPanel({ renderedAt, roles }: { renderedAt: number; roles: RoleListItem[] }) {
  const params = useSearchParams();
  const status = parseStatusFilter(params.get("status"));
  const sort = parseRoleSort(params.get("sort"));
  const now = useCurrentMinute(renderedAt);
  const timeZone = useViewerTimeZone();

  const [optimisticRoles, showStatusChange] = useOptimistic(roles, applyStatusChange);
  const [query, setQuery] = useState(() => params.get("q") ?? "");
  const [limit, setLimit] = useState(pageSize);
  const [notice, setNotice] = useState<Notice | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const addressTimer = useRef<number | undefined>(undefined);

  const searched = searchRoles(optimisticRoles, query);
  const counts = countByStatus(searched);
  const matching = sortRoles(status ? searched.filter((role) => role.status === status) : searched, sort);
  const shown = matching.slice(0, limit);
  const filtered = Boolean(status || query.trim());

  // A different view starts again from the top of the list.
  const view = `${status}|${query}|${sort.key}|${sort.direction}`;
  const [seenView, setSeenView] = useState(view);
  if (seenView !== view) {
    setSeenView(view);
    setLimit(pageSize);
  }

  function pushView(changes: Record<string, string | null>) {
    window.history.pushState(null, "", viewAddress(window.location.search, changes));
  }

  function replaceView(changes: Record<string, string | null>) {
    window.history.replaceState(null, "", viewAddress(window.location.search, changes));
  }

  function changeQuery(next: string) {
    setQuery(next);
    window.clearTimeout(addressTimer.current);
    addressTimer.current = window.setTimeout(() => replaceView({ q: next.trim() || null }), 250);
  }

  function clearFilters() {
    window.clearTimeout(addressTimer.current);
    setQuery("");
    pushView({ q: null, status: null });
  }

  function changeSort(next: RoleSort) {
    replaceView({ sort: formatRoleSort(next) });
  }

  function moveRole(role: RoleListItem, next: ApplicationStatus, undoing = false) {
    const at = new Date().toISOString();
    // Only an undo brings a date back, and only the one this role had before the move.
    const restoreAppliedAt = undoing ? role.applied_at : null;
    startTransition(async () => {
      showStatusChange({ at, id: role.id, restoreAppliedAt, status: next });
      const form = new FormData();
      form.set("applicationId", role.id);
      form.set("status", next);
      if (restoreAppliedAt) form.set("restoreAppliedAt", restoreAppliedAt);

      const showFailure = (message: string) => setNotice({ key: `${role.id}-${at}`, roleId: role.id, text: `${role.company}: ${message}`, tone: "error" });
      let result;
      try {
        result = await changeStatusAction({}, form);
      } catch {
        showFailure("Could not change the status. Check your connection and try again.");
        return;
      }
      if (!result.success) {
        // The save can succeed even when a later step fails, so show what is really stored.
        refreshQuietly();
        showFailure(result.errors?.status?.[0] ?? result.message ?? "Could not change the status. Try again.");
        return;
      }
      const clearedDate = next === "SAVED" && role.applied_at && !undoing;
      setNotice({
        key: `${role.id}-${at}`,
        roleId: role.id,
        text: `${role.company} moved ${undoing ? "back " : ""}to ${titleCase(next)}.${clearedDate ? " Applied date cleared." : ""}`,
        tone: "success",
        undo: undoing ? undefined : () => {
          setNotice(null);
          moveRole(role, role.status, true);
        },
      });
    });
  }

  // The address changes after a short pause in typing, so stop that from
  // reaching another page if this one is left first.
  useEffect(() => () => window.clearTimeout(addressTimer.current), []);

  // Back and Forward change the address, and the search box has to follow.
  useEffect(() => {
    const followHistory = () => {
      window.clearTimeout(addressTimer.current);
      setQuery(new URLSearchParams(window.location.search).get("q") ?? "");
    };
    window.addEventListener("popstate", followHistory);
    return () => window.removeEventListener("popstate", followHistory);
  }, []);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const typing = event.target instanceof Element && event.target.closest("input, select, textarea, [contenteditable]");
      if (typing || document.querySelector(".modal-backdrop, dialog[open]")) return;
      event.preventDefault();
      searchInput.current?.focus();
    };
    document.addEventListener("keydown", focusSearch);
    return () => document.removeEventListener("keydown", focusSearch);
  }, []);

  // Jobs are saved from other tabs and PDFs finish in the background, so catch up
  // on return to this tab, and keep checking while a PDF is still being made.
  const processing = roles.some((role) => role.document_status === "PENDING" || role.document_status === "PROCESSING");
  useEffect(() => {
    let lastRefresh = Date.now();
    const refresh = (gap: number) => {
      if (document.hidden || Date.now() - lastRefresh < gap) return;
      lastRefresh = Date.now();
      refreshQuietly();
    };
    const onReturn = () => refresh(returnRefreshGap);
    document.addEventListener("visibilitychange", onReturn);
    const interval = processing ? window.setInterval(() => refresh(0), processingRefresh) : undefined;
    return () => {
      document.removeEventListener("visibilitychange", onReturn);
      window.clearInterval(interval);
    };
  }, [processing]);

  const search = params.toString();
  const tabs = [
    { active: !status, count: searched.length, href: viewAddress(search, { status: null }), label: "All", onSelect: () => pushView({ status: null }) },
    ...selectableApplicationStatuses.map((item) => ({
      active: status === item,
      count: counts.get(item) ?? 0,
      href: viewAddress(search, { status: status === item ? null : item }),
      label: titleCase(item),
      // Choosing the current status again goes back to all roles.
      onSelect: () => pushView({ status: status === item ? null : item }),
    })),
  ];

  return (
    <section aria-label="Roles" className="panel applications-panel">
      <RoleSelection roles={shown.map((role) => ({ id: role.id, name: `${role.company}, ${role.position}` }))}>
        {/* Inside RoleSelection, so the message about deleting the last roles still shows. */}
        {roles.length === 0 ? (
          <PanelEmptyState action={<ApplicationCreateForm />} title="No roles here yet">
            Add your first role here, or save a job page with the browser extension.
          </PanelEmptyState>
        ) : (
          <>
            <div className="roles-toolbar">
              <label className="role-search">
                <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
                <input
                  aria-label="Search roles by company or position"
                  autoComplete="off"
                  name="role-search"
                  onChange={(event) => changeQuery(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Escape" && query) changeQuery(""); }}
                  placeholder="Search company or role"
                  ref={searchInput}
                  type="search"
                  value={query}
                />
                {!query && <kbd aria-hidden="true">/</kbd>}
              </label>
              {filtered && <p className="roles-summary">{matching.length.toLocaleString("en-US")} of {roleCount(optimisticRoles.length)} <button className="inline-button" onClick={clearFilters} type="button">Clear filters</button></p>}
              <div className="roles-toolbar-end"><ExportRoles applicationIds={matching.map((role) => role.id)} /></div>
            </div>

            <nav aria-label="Filter roles by status" className="status-tabs">
              <div className="status-tabs-list">{tabs.map((tab) => <StatusTab key={tab.label} {...tab} />)}</div>
            </nav>

            {matching.length === 0 ? (
              <PanelEmptyState action={<button className="secondary-button" onClick={clearFilters} type="button">Clear filters</button>} title="No roles match">
                {query.trim() ? `Nothing${status ? ` in ${titleCase(status)}` : ""} matches “${query.trim()}”.` : `You have no ${titleCase(status ?? "").toLowerCase()} roles right now.`}
              </PanelEmptyState>
            ) : (
              <div className="table-wrap">
                {/* The explicit roles keep this a table for screen readers when it is restyled as stacked rows. */}
                <table role="table">
                  <thead role="rowgroup">
                    <tr role="row">
                      <th aria-sort={ariaSort(sort, "company")} role="columnheader">
                        <span className="role-heading">
                          <span className="role-cell"><SelectAllRoles /><SortButton label="Company & role" onSort={(key) => changeSort(nextRoleSort(sort, key))} sort={sort} sortKey="company" /></span>
                          <select aria-label="Sort roles" autoComplete="off" className="sort-select" onChange={(event) => changeSort(parseRoleSort(event.target.value))} value={`${sort.key}-${sort.direction}`}>
                            {sortChoices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
                          </select>
                        </span>
                      </th>
                      <th aria-sort={ariaSort(sort, "status")} role="columnheader"><SortButton label="Status" onSort={(key) => changeSort(nextRoleSort(sort, key))} sort={sort} sortKey="status" /></th>
                      <th aria-sort={ariaSort(sort, "applied")} role="columnheader"><SortButton label="Applied" onSort={(key) => changeSort(nextRoleSort(sort, key))} sort={sort} sortKey="applied" /></th>
                      <th role="columnheader">Job description</th>
                      <th aria-sort={ariaSort(sort, "updated")} role="columnheader"><SortButton label="Updated" onSort={(key) => changeSort(nextRoleSort(sort, key))} sort={sort} sortKey="updated" /></th>
                    </tr>
                  </thead>
                  <tbody role="rowgroup">
                    {shown.map((role) => <RoleRow changed={notice?.tone === "success" && notice.roleId === role.id} key={role.id} now={now} onStatusChange={moveRole} role={role} timeZone={timeZone} />)}
                  </tbody>
                </table>
              </div>
            )}

            {matching.length > shown.length && (
              <div className="table-more">
                <span>Showing {shown.length.toLocaleString("en-US")} of {matching.length.toLocaleString("en-US")}</span>
                <button className="secondary-button" onClick={() => setLimit((current) => current + pageSize)} type="button">Show {Math.min(pageSize, matching.length - shown.length)} more</button>
                <button className="text-button" onClick={() => setLimit(Number.POSITIVE_INFINITY)} type="button">Show all</button>
              </div>
            )}
          </>
        )}

        <div className="table-dock">
          <div aria-live="polite" className="dock-notices" role="status">
            {notice && (
              <DockNotice
                action={notice.undo ? { label: "Undo", onClick: notice.undo } : undefined}
                key={notice.key}
                onDismiss={() => setNotice(null)}
                tone={notice.tone}
              >
                {notice.text}
              </DockNotice>
            )}
            <ExportResult />
            <DeleteResult />
          </div>
          <SelectionBar />
        </div>
      </RoleSelection>
    </section>
  );
}
