"use client";

import { createContext, useContext, useEffect, useEffectEvent, useState, type ReactNode } from "react";
import { deleteConfirmation } from "@/lib/delete-confirmation";
import { deleteApplicationsAction, type ApplicationActionState } from "./actions";
import { ConfirmDialog } from "./confirm-dialog";

interface ListedRole {
  id: string;
  name: string;
}

interface RoleSelectionValue {
  deleteState: ApplicationActionState;
  exportError: string;
  roles: ListedRole[];
  selected: ReadonlySet<string>;
  setExportError: (message: string) => void;
  setSelected: (next: ReadonlySet<string>) => void;
  submitDelete: (formData: FormData) => Promise<void>;
  toggle: (id: string) => void;
}

const RoleSelectionContext = createContext<RoleSelectionValue | null>(null);
const initialState: ApplicationActionState = {};
const noticeDuration = 10_000;

function useRoleSelection() {
  const value = useContext(RoleSelectionContext);
  if (!value) throw new Error("Role selection controls must be inside RoleSelection.");
  return value;
}

export function RoleSelection({ children, roles }: { children: ReactNode; roles: ListedRole[] }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [exportError, setExportError] = useState("");
  const [deleteState, setDeleteState] = useState(initialState);

  async function submitDelete(formData: FormData) {
    setDeleteState(await deleteApplicationsAction(initialState, formData));
  }

  // Only rows on screen stay selected, so a filter change or a finished delete
  // can never leave a hidden role ready to be deleted.
  const listedIds = roles.map((role) => role.id).join();
  const [seenIds, setSeenIds] = useState(listedIds);
  if (seenIds !== listedIds) {
    setSeenIds(listedIds);
    setSelected(new Set(roles.flatMap((role) => selected.has(role.id) ? [role.id] : [])));
  }

  function toggle(id: string) {
    const next = new Set(selected);
    if (!next.delete(id)) next.add(id);
    setSelected(next);
  }

  return (
    <RoleSelectionContext.Provider value={{ deleteState, exportError, roles, selected, setExportError, setSelected, submitDelete, toggle }}>
      {children}
    </RoleSelectionContext.Provider>
  );
}

export function SelectAllRoles() {
  const { roles, selected, setSelected } = useRoleSelection();
  const allSelected = roles.length > 0 && selected.size === roles.length;
  return (
    <label className="role-check">
      <input
        aria-label="Select all roles showing"
        autoComplete="off"
        checked={allSelected}
        onChange={() => setSelected(new Set(allSelected ? [] : roles.map((role) => role.id)))}
        ref={(input) => { if (input) input.indeterminate = selected.size > 0 && !allSelected; }}
        type="checkbox"
      />
    </label>
  );
}

export function RoleCheckbox({ id, name }: ListedRole) {
  const { selected, toggle } = useRoleSelection();
  return (
    <label className="role-check">
      <input aria-label={`Select ${name}`} autoComplete="off" checked={selected.has(id)} onChange={() => toggle(id)} type="checkbox" />
    </label>
  );
}

export function DeleteSelectedRoles() {
  const { roles, selected, submitDelete } = useRoleSelection();
  const chosen = roles.filter((role) => selected.has(role.id));
  const [dialogOpen, setDialogOpen] = useState(false);
  const content = deleteConfirmation(chosen.map((role) => role.name));

  return (
    <>
      <button className="danger-button" disabled={chosen.length === 0} onClick={() => setDialogOpen(true)} type="button">Delete…</button>
      {dialogOpen && chosen.length > 0 && (
        <ConfirmDialog
          action={submitDelete}
          confirmLabel={content.confirmLabel}
          description={content.description}
          items={content.names.map((name) => ({ name }))}
          listLabel="Roles selected for deletion"
          moreText={content.remainingCount > 0 ? `And ${content.remainingCount} more selected ${content.remainingCount === 1 ? "role" : "roles"}.` : undefined}
          onClose={() => setDialogOpen(false)}
          title={content.title}
        >
          {chosen.map((role) => <input key={role.id} name="applicationId" type="hidden" value={role.id} />)}
        </ConfirmDialog>
      )}
    </>
  );
}

/** Downloads the given roles as an Excel workbook. A failure shows in the dock, with the other messages. */
function ExportButton({ applicationIds, label, title }: { applicationIds: string[]; label: string; title?: string }) {
  const { setExportError } = useRoleSelection();
  const [exporting, setExporting] = useState(false);

  async function downloadWorkbook() {
    setExporting(true);
    setExportError("");
    try {
      const response = await fetch("/dashboard/applications/export", {
        body: JSON.stringify({
          applicationIds,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const contentType = response.headers.get("Content-Type") ?? "";
      if (!response.ok || !contentType.includes("spreadsheetml")) {
        throw new Error(response.ok ? "The downloaded file was not an Excel workbook." : await response.text());
      }

      const disposition = response.headers.get("Content-Disposition") ?? "";
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? "rolesave-applications.xlsx";
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      setExportError(error instanceof Error && error.message ? error.message : "Could not download those roles.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <button className="secondary-button export-button" disabled={applicationIds.length === 0 || exporting} onClick={() => void downloadWorkbook()} title={title} type="button">
      <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 19h14" /></svg>
      {exporting ? "Preparing…" : label}
    </button>
  );
}

/** Always above the table, so a download never depends on finding the checkboxes first. */
export function ExportRoles({ applicationIds }: { applicationIds: string[] }) {
  const count = applicationIds.length;
  return <ExportButton applicationIds={applicationIds} label="Export" title={`Download ${count === 1 ? "the 1 role" : `all ${count.toLocaleString("en-US")} roles`} in this view as an Excel file`} />;
}

export function ExportSelectedRoles() {
  const { roles, selected } = useRoleSelection();
  return <ExportButton applicationIds={roles.filter((role) => selected.has(role.id)).map((role) => role.id)} label="Export selected" />;
}

/** Appears once something is selected, so the controls for a selection are there only when they apply. */
export function SelectionBar() {
  const { selected, setSelected } = useRoleSelection();
  if (selected.size === 0) return null;
  return (
    <div aria-label="Selected roles" className="selection-bar" role="region">
      <strong>{selected.size.toLocaleString("en-US")} selected</strong>
      <button className="text-button" onClick={() => setSelected(new Set())} type="button">Clear</button>
      <span className="selection-bar-actions"><ExportSelectedRoles /><DeleteSelectedRoles /></span>
    </div>
  );
}

/** A short message pinned above the table. Good news goes by itself, but an error waits to be read. */
export function DockNotice({ action, children, onDismiss, tone }: {
  action?: { label: string; onClick: () => void };
  children: ReactNode;
  onDismiss: () => void;
  tone: "error" | "success";
}) {
  const dismiss = useEffectEvent(onDismiss);
  useEffect(() => {
    if (tone === "error") return;
    const timer = window.setTimeout(() => dismiss(), noticeDuration);
    return () => window.clearTimeout(timer);
  }, [tone]);

  return (
    <div className={`dock-notice ${tone}`}>
      <span>{children}</span>
      {action && <button className="dock-notice-action" onClick={action.onClick} type="button">{action.label}</button>}
      <button aria-label="Dismiss" className="dock-notice-close" onClick={onDismiss} type="button">×</button>
    </div>
  );
}

export function DeleteResult() {
  const { deleteState, selected } = useRoleSelection();
  const [dismissed, setDismissed] = useState<ApplicationActionState | null>(null);
  // A success note is about the last delete, so it goes once the next selection starts.
  if (!deleteState.message || deleteState === dismissed || (deleteState.success && selected.size > 0)) return null;
  return <DockNotice onDismiss={() => setDismissed(deleteState)} tone={deleteState.success ? "success" : "error"}>{deleteState.message}</DockNotice>;
}

export function ExportResult() {
  const { exportError, setExportError } = useRoleSelection();
  if (!exportError) return null;
  return <DockNotice onDismiss={() => setExportError("")} tone="error">{exportError}</DockNotice>;
}
