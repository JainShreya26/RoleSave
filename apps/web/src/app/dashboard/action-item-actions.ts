"use server";

import { applicationActionSchema, isUuid } from "@rolesave/validation";
import { refresh, revalidatePath } from "next/cache";
import { requireViewer } from "@/lib/auth";
import type { ApplicationActionState } from "./actions";

function parseAction(formData: FormData) {
  return applicationActionSchema.safeParse({
    title: formData.get("title"),
    dueAt: formData.get("dueAt"),
    remindAt: formData.get("remindAt") || null,
  });
}

function refreshActionViews(applicationId: string) {
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/actions");
  revalidatePath(`/dashboard/applications/${applicationId}`);
}

export async function createActionItem(
  _previousState: ApplicationActionState,
  formData: FormData,
): Promise<ApplicationActionState> {
  void _previousState;
  const applicationId = formData.get("applicationId");
  if (!isUuid(applicationId)) return { message: "Role not found." };
  const parsed = parseAction(formData);
  if (!parsed.success) return { message: parsed.error.issues[0]?.message ?? "Check the action details." };

  const { supabase, viewer } = await requireViewer();
  const { data: application, error: lookupError } = await supabase
    .from("applications").select("id").eq("id", applicationId).eq("user_id", viewer.id).maybeSingle();
  if (lookupError || !application) return { message: "Role not found." };

  const { error } = await supabase.from("application_actions").insert({
    application_id: applicationId,
    user_id: viewer.id,
    title: parsed.data.title,
    due_at: parsed.data.dueAt,
    remind_at: parsed.data.remindAt,
  });
  if (error) return { message: `Unable to add action: ${error.message}` };
  refreshActionViews(applicationId);
  return { message: "Action added.", success: true };
}

export async function updateActionItem(
  _previousState: ApplicationActionState,
  formData: FormData,
): Promise<ApplicationActionState> {
  void _previousState;
  const actionId = formData.get("actionId");
  if (!isUuid(actionId)) return { message: "Action not found." };
  const parsed = parseAction(formData);
  if (!parsed.success) return { message: parsed.error.issues[0]?.message ?? "Check the action details." };

  const { supabase, viewer } = await requireViewer();
  const { data: current, error: lookupError } = await supabase.from("application_actions")
    .select("application_id").eq("id", actionId).eq("user_id", viewer.id).maybeSingle();
  if (lookupError || !current) return { message: "Action not found." };

  const { error } = await supabase.from("application_actions").update({
    title: parsed.data.title,
    due_at: parsed.data.dueAt,
    remind_at: parsed.data.remindAt,
  }).eq("id", actionId).eq("user_id", viewer.id);
  if (error) return { message: `Unable to update action: ${error.message}` };
  refreshActionViews(current.application_id);
  return { message: "Action updated.", success: true };
}

export async function setActionCompletion(actionId: string, complete: boolean, _formData: FormData) {
  void _formData;
  const { supabase, viewer } = await requireViewer();
  const { data: current, error: lookupError } = await supabase.from("application_actions")
    .select("application_id").eq("id", actionId).eq("user_id", viewer.id).maybeSingle();
  if (lookupError) throw new Error(`Unable to find the action: ${lookupError.message}`);
  // Already deleted, perhaps in another tab, so just show the current list.
  if (!current) {
    refresh();
    return;
  }
  const { error } = await supabase.from("application_actions")
    .update({ completed_at: complete ? new Date().toISOString() : null })
    .eq("id", actionId).eq("user_id", viewer.id);
  if (error) throw new Error(`Unable to update action: ${error.message}`);
  refreshActionViews(current.application_id);
}

export async function deleteActionItem(actionId: string, _formData: FormData) {
  void _formData;
  const { supabase, viewer } = await requireViewer();
  const { data: current, error: lookupError } = await supabase.from("application_actions")
    .select("application_id").eq("id", actionId).eq("user_id", viewer.id).maybeSingle();
  if (lookupError) throw new Error(`Unable to find the action: ${lookupError.message}`);
  // Already deleted, perhaps in another tab, so just show the current list.
  if (!current) {
    refresh();
    return;
  }
  const { error } = await supabase.from("application_actions")
    .delete().eq("id", actionId).eq("user_id", viewer.id);
  if (error) throw new Error(`Unable to delete action: ${error.message}`);
  refreshActionViews(current.application_id);
}
