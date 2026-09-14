"use server";

import { revalidatePath } from "next/cache";
import { requireViewer } from "@/lib/auth";

export interface EmailMatchActionState {
  message?: string;
  success?: boolean;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function reassignEmailMatchAction(
  currentApplicationId: string,
  _previousState: EmailMatchActionState,
  formData: FormData,
): Promise<EmailMatchActionState> {
  void _previousState;
  const emailEventId = formData.get("emailEventId");
  const applicationId = formData.get("applicationId");
  if (typeof emailEventId !== "string" || !uuidPattern.test(emailEventId)
    || typeof applicationId !== "string" || !uuidPattern.test(applicationId)) {
    return { message: "Choose the application that should receive this email." };
  }
  if (applicationId === currentApplicationId) {
    return { message: "This email is already attached to that application." };
  }

  const { supabase } = await requireViewer();
  const { data, error } = await supabase.rpc("reassign_email_event_match", {
    p_application_id: applicationId,
    p_email_event_id: emailEventId,
  });
  if (error || !data) {
    return { message: error?.message ?? "The email could not be reassigned." };
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/review");
  revalidatePath(`/dashboard/applications/${currentApplicationId}`);
  revalidatePath(`/dashboard/applications/${applicationId}`);
  return { message: "Email moved to the selected application.", success: true };
}

export async function undoEmailMatchAction(
  currentApplicationId: string,
  _previousState: EmailMatchActionState,
  formData: FormData,
): Promise<EmailMatchActionState> {
  void _previousState;
  const emailEventId = formData.get("emailEventId");
  if (typeof emailEventId !== "string" || !uuidPattern.test(emailEventId)) {
    return { message: "The email match could not be identified." };
  }

  const { supabase } = await requireViewer();
  const { data, error } = await supabase.rpc("undo_email_event_match", {
    p_email_event_id: emailEventId,
  });
  if (error || !data) {
    return { message: error?.message ?? "The email match could not be undone." };
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/review");
  revalidatePath(`/dashboard/applications/${currentApplicationId}`);
  return { message: "Email detached and returned to Needs Review.", success: true };
}
