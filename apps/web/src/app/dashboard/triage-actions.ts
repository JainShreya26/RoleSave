"use server";

import { isUuid, triageSchema } from "@rolesave/validation";
import { revalidatePath } from "next/cache";
import { requireViewer } from "@/lib/auth";
import type { ApplicationActionState } from "./actions";

async function writeTriage(applicationId: string, decision: string | null, reason: string | null | undefined) {
  const parsed = triageSchema.safeParse({ decision, reason: reason ?? null });
  if (!parsed.success) return { message: "Choose a decision and keep the reason under 500 characters." };

  const { supabase, viewer } = await requireViewer();
  const { data: application, error: lookupError } = await supabase
    .from("applications")
    .select("id,status,triage_decision,triage_reason")
    .eq("id", applicationId)
    .eq("user_id", viewer.id)
    .maybeSingle();
  if (lookupError || !application) return { message: "Saved role not found." };
  if (application.status !== "SAVED") return { message: "Decisions can only be changed for saved roles." };

  const nextReason = parsed.data.decision
    ? reason === undefined && application.triage_decision === parsed.data.decision
      ? application.triage_reason
      : parsed.data.reason
    : null;
  if (application.triage_decision === parsed.data.decision && application.triage_reason === nextReason) {
    return { message: "Decision is already current.", success: true };
  }
  const { error } = await supabase
    .from("applications")
    .update({ triage_decision: parsed.data.decision, triage_reason: nextReason })
    .eq("id", applicationId)
    .eq("user_id", viewer.id);
  if (error) return { message: `Unable to save decision: ${error.message}` };

  const label = parsed.data.decision?.toLowerCase() ?? "not reviewed";
  const { error: eventError } = await supabase.from("application_events").insert({
    application_id: applicationId,
    event_time: new Date().toISOString(),
    event_type: "GENERAL_UPDATE",
    evidence: `Saved-role decision changed to ${label}${nextReason ? `: ${nextReason}` : ""}`,
    source: "MANUAL",
    user_id: viewer.id,
  });
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/applications/${applicationId}`);
  if (eventError) return { message: "Decision saved, but its timeline event could not be recorded." };
  return { message: "Decision saved.", success: true };
}

export async function saveTriageAction(
  _previousState: ApplicationActionState,
  formData: FormData,
): Promise<ApplicationActionState> {
  void _previousState;
  const applicationId = formData.get("applicationId");
  if (!isUuid(applicationId)) return { message: "Saved role not found." };
  const rawDecision = formData.get("decision");
  const rawReason = formData.get("reason");
  return writeTriage(
    applicationId,
    typeof rawDecision === "string" && rawDecision ? rawDecision : null,
    typeof rawReason === "string" && rawReason.trim() ? rawReason.trim() : null,
  );
}

export async function quickTriageAction(
  _previousState: ApplicationActionState,
  formData: FormData,
): Promise<ApplicationActionState> {
  void _previousState;
  const applicationId = formData.get("applicationId");
  if (!isUuid(applicationId)) return { message: "Saved role not found." };
  const decision = formData.get("decision");
  return writeTriage(applicationId, typeof decision === "string" && decision ? decision : null, undefined);
}
