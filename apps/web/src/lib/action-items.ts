import "server-only";

import { requireViewer } from "@/lib/auth";
import type { Database } from "@/lib/supabase/database.types";
import { fetchAllRows } from "@/lib/supabase/fetch-all";

export type ActionItem = Pick<
  Database["public"]["Tables"]["application_actions"]["Row"],
  "id" | "application_id" | "title" | "due_at" | "remind_at" | "completed_at"
> & { company: string; position: string; roleStatus: string; triageDecision: string | null };

export async function listActionItems(applicationId?: string): Promise<ActionItem[]> {
  const { supabase, viewer } = await requireViewer();
  const { data: actions, error } = await fetchAllRows((from, to) => {
    let query = supabase
      .from("application_actions")
      .select("id,application_id,title,due_at,remind_at,completed_at")
      .eq("user_id", viewer.id);
    if (applicationId) query = query.eq("application_id", applicationId);
    return query.order("id").range(from, to);
  });
  if (error) throw new Error(`Unable to load actions: ${error.message}`);
  if (actions.length === 0) return [];

  // Read by user rather than listing every application ID: enough IDs make the
  // request too long for the server, which is refused outright.
  const { data: applications, error: applicationError } = await fetchAllRows((from, to) => {
    let query = supabase
      .from("applications")
      .select("id,company,position,status,triage_decision")
      .eq("user_id", viewer.id);
    if (applicationId) query = query.eq("id", applicationId);
    return query.order("id").range(from, to);
  });
  if (applicationError) throw new Error(`Unable to load action roles: ${applicationError.message}`);
  const labels = new Map(applications.map((item) => [item.id, item]));

  const soonestFirst = [...actions].sort((left, right) => Date.parse(left.due_at) - Date.parse(right.due_at));
  return soonestFirst.flatMap((item) => {
    const application = labels.get(item.application_id);
    return application ? [{
      ...item,
      company: application.company,
      position: application.position,
      roleStatus: application.status,
      triageDecision: application.triage_decision,
    }] : [];
  });
}
