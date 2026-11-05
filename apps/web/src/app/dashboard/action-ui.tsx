"use client";

import Link from "next/link";
import { useActionState, useEffect, useId, useState } from "react";
import type { ActionItem } from "@/lib/action-items";
import { actionTiming, type ActionTiming } from "@/lib/action-timing";
import type { ApplicationActionState } from "./actions";
import { createActionItem, deleteActionItem, setActionCompletion, updateActionItem } from "./action-item-actions";

const initialState: ApplicationActionState = {};
// Needs attention sits above the roles table, so it must not push it far down.
const compactLimit = 5;
type ReminderChoice = "NONE" | "AT_DUE" | "ONE_DAY" | "THREE_DAYS" | "CUSTOM";
type ActionBucket = ActionTiming | "paused" | "completed";

function localInputParts(value: string) {
  const date = new Date(value);
  return {
    day: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
    time: `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`,
  };
}

function localDateTime(day: string, time: string) {
  if (!day) return null;
  const value = new Date(`${day}T${time || "09:00"}`);
  return Number.isFinite(value.valueOf()) ? value : null;
}

function classifyAction(item: ActionItem, now: Date): ActionBucket {
  if (item.completed_at) return "completed";
  if (item.roleStatus === "SAVED" && item.triageDecision === "PASS") return "paused";
  return actionTiming(item, now);
}

function formatDue(value: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function ActionForm({ applicationId, existing, onDone }: {
  applicationId: string;
  existing?: ActionItem;
  onDone?: () => void;
}) {
  const [title, setTitle] = useState(existing?.title ?? "");
  const suggestionsId = useId();
  const initialDue = existing ? localInputParts(existing.due_at) : null;
  const initialReminder = existing?.remind_at ? localInputParts(existing.remind_at) : null;
  const [dueDay, setDueDay] = useState(initialDue?.day ?? "");
  const [dueTime, setDueTime] = useState(initialDue?.time ?? "");
  const [reminder, setReminder] = useState<ReminderChoice>(existing?.remind_at ? "CUSTOM" : "NONE");
  const [customDay, setCustomDay] = useState(initialReminder?.day ?? "");
  const [customTime, setCustomTime] = useState(initialReminder?.time ?? "");
  const [state, submit, pending] = useActionState(existing ? updateActionItem : createActionItem, initialState);

  // A new action clears the form for the next one and keeps the success message.
  const [handledState, setHandledState] = useState(state);
  if (state !== handledState) {
    setHandledState(state);
    if (state.success && !existing) {
      setTitle("");
      setDueDay("");
      setDueTime("");
      setReminder("NONE");
      setCustomDay("");
      setCustomTime("");
    }
  }

  // A saved edit closes its form. The row itself shows the result.
  useEffect(() => {
    if (state.success && existing) onDone?.();
  }, [existing, onDone, state]);

  const dueDate = localDateTime(dueDay, dueTime);
  let reminderDate: Date | null = null;
  if (dueDate && reminder !== "NONE") {
    if (reminder === "CUSTOM") reminderDate = localDateTime(customDay, customTime);
    else {
      reminderDate = new Date(dueDate);
      if (reminder === "ONE_DAY") reminderDate.setDate(reminderDate.getDate() - 1);
      if (reminder === "THREE_DAYS") reminderDate.setDate(reminderDate.getDate() - 3);
    }
  }
  const reminderInvalid = reminder !== "NONE" && (!reminderDate || !dueDate || reminderDate > dueDate);

  return (
    <form action={submit} className="stack-form action-form">
      {existing
        ? <input name="actionId" type="hidden" value={existing.id} />
        : <input name="applicationId" type="hidden" value={applicationId} />}
      <label>Action
        <input list={suggestionsId} maxLength={200} name="title" onChange={(event) => setTitle(event.target.value)} placeholder="Follow up with recruiter" required value={title} />
      </label>
      <datalist id={suggestionsId}><option value="Finish application" /><option value="Follow up on application" /><option value="Prepare for interview" /><option value="Send thank-you note" /></datalist>
      <div className="action-date-grid">
        <label>Due date<input name="dueDay" onChange={(event) => setDueDay(event.target.value)} required type="date" value={dueDay} /></label>
        <label>Time (optional)<input name="dueTime" onChange={(event) => setDueTime(event.target.value)} type="time" value={dueTime} /></label>
      </div>
      <small className="action-help">If time is blank, use 9:00 AM in your local time zone.</small>
      <label>Show in-app reminder
        <select onChange={(event) => setReminder(event.target.value as ReminderChoice)} value={reminder}>
          <option value="NONE">At due date only</option>
          <option value="AT_DUE">At due time</option>
          <option value="ONE_DAY">1 day before</option>
          <option value="THREE_DAYS">3 days before</option>
          <option value="CUSTOM">Custom time</option>
        </select>
      </label>
      {reminder === "CUSTOM" && <div className="action-date-grid">
        <label>Reminder date<input onChange={(event) => setCustomDay(event.target.value)} required type="date" value={customDay} /></label>
        <label>Time (optional)<input onChange={(event) => setCustomTime(event.target.value)} type="time" value={customTime} /></label>
      </div>}
      {reminderInvalid && <p className="field-error">Choose a reminder no later than the due time.</p>}
      <input name="dueAt" type="hidden" value={dueDate?.toISOString() ?? ""} />
      <input name="remindAt" type="hidden" value={reminderDate?.toISOString() ?? ""} />
      {state.message && <p aria-live="polite" className={`form-message ${state.success ? "success" : "error"}`}>{state.message}</p>}
      <div className="form-actions">
        {onDone && <button className="secondary-button" onClick={onDone} type="button">Cancel</button>}
        <button className="primary-button" disabled={pending || !dueDate || reminderInvalid} type="submit">
          {pending ? "Saving…" : existing ? "Save action" : "Add action"}
        </button>
      </div>
    </form>
  );
}

function ActionRow({ item, bucket, editable }: { item: ActionItem; bucket: ActionBucket; editable: boolean }) {
  const [editing, setEditing] = useState(false);
  return <li className={`action-row ${bucket}`}>
    <form action={setActionCompletion.bind(null, item.id, !item.completed_at)}>
      <button aria-label={item.completed_at ? `Reopen ${item.title}` : `Complete ${item.title}`} className="action-check" type="submit">{item.completed_at ? "✓" : ""}</button>
    </form>
    <div className="action-row-body">
      <strong>{item.title}</strong>
      <Link href={`/dashboard/applications/${item.application_id}`}>{item.company} · {item.position}</Link>
      <small suppressHydrationWarning>{formatDue(item.due_at)}</small>
      {editing && <ActionForm applicationId={item.application_id} existing={item} onDone={() => setEditing(false)} />}
    </div>
    <div className="action-row-end">
      {bucket !== "upcoming" && bucket !== "completed" && <span className={`action-tag ${bucket}`}>{bucket === "reminder" ? "Reminder" : bucket}</span>}
      {editable && <>
        <button className="text-button" onClick={() => setEditing((value) => !value)} type="button">Edit</button>
        <form action={deleteActionItem.bind(null, item.id)} onSubmit={(event) => {
          if (!window.confirm(`Delete “${item.title}”?`)) event.preventDefault();
        }}><button className="text-button" type="submit">Delete</button></form>
      </>}
    </div>
  </li>;
}

export function ActionList({ actions, compact = false, emptyMessage = "No actions yet. Open a role to add one." }: {
  actions: ActionItem[];
  compact?: boolean;
  emptyMessage?: string;
}) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const first = window.setTimeout(() => setNow(new Date()), 0);
    const interval = window.setInterval(() => setNow(new Date()), 30_000);
    return () => { window.clearTimeout(first); window.clearInterval(interval); };
  }, []);
  if (!now) return <p className="action-loading">Loading actions…</p>;

  const groups: { key: ActionBucket; title: string }[] = [
    { key: "overdue", title: "Overdue" },
    { key: "reminder", title: "Reminders" },
    { key: "today", title: "Due today" },
    { key: "upcoming", title: "Upcoming" },
    { key: "paused", title: "Paused for passed roles" },
    { key: "completed", title: "Completed" },
  ];
  const visible = compact ? groups.filter((group) => ["overdue", "reminder", "today"].includes(group.key)) : groups;
  const count = actions.filter((item) => ["overdue", "reminder", "today"].includes(classifyAction(item, now))).length;

  if (compact && count === 0) return <div className="action-empty">Nothing needs attention right now. <Link href="/dashboard/actions">View all actions</Link></div>;
  if (!compact && actions.length === 0) return <div className="empty-state compact"><p>{emptyMessage}</p></div>;

  let room = compact ? compactLimit : Number.POSITIVE_INFINITY;
  const sections = visible.map((group) => {
    const items = actions.filter((item) => classifyAction(item, now) === group.key);
    const shown = items.slice(0, room);
    room -= shown.length;
    return { ...group, shown, total: items.length };
  });

  return <div className="action-groups">
    {sections.map((group) => {
      if (group.shown.length === 0) return null;
      return <section className="action-group" key={group.key}>
        <h3>{group.title} <span>{group.total}</span></h3>
        <ul>{group.shown.map((item) => <ActionRow bucket={group.key} editable={!compact} item={item} key={item.id} />)}</ul>
      </section>;
    })}
    {compact && count > compactLimit && <Link className="text-link action-more" href="/dashboard/actions">View all {count} actions that need attention →</Link>}
  </div>;
}
