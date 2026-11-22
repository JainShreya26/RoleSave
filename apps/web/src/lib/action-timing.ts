export type ActionTiming = "overdue" | "reminder" | "today" | "upcoming";

/** Sent on the window when an action changes, so the sidebar count needn't wait for its next check. */
export const actionsChangedEvent = "rolesave:actions-changed";

/**
 * Where an open action stands right now. Anything but "upcoming" needs attention.
 * A reminder only brings an action forward: one due today counts as due today
 * even while its reminder is still to come.
 */
export function actionTiming(action: { due_at: string; remind_at: string | null }, now: Date): ActionTiming {
  const due = new Date(action.due_at);
  if (due <= now) return "overdue";
  if (action.remind_at && new Date(action.remind_at) <= now) return "reminder";
  return due.toDateString() === now.toDateString() ? "today" : "upcoming";
}
