"use server";

import { revalidatePath } from "next/cache";
import { requireViewer } from "@/lib/auth";

export interface ReviewActionState {
  message?: string;
  success?: boolean;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function resolveReviewTaskAction(
  _previousState: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  void _previousState;
  const taskId = formData.get("taskId");
  const applicationId = formData.get("applicationId");
  if (typeof taskId !== "string" || !uuidPattern.test(taskId)
    || typeof applicationId !== "string" || !uuidPattern.test(applicationId)) {
    return { message: "Choose a valid application." };
  }

  const { supabase } = await requireViewer();
  const { data, error } = await supabase.rpc("resolve_email_review_task", {
    p_application_id: applicationId,
    p_review_task_id: taskId,
  });
  if (error || !data) {
    return { message: error?.message ?? "This review task is no longer available." };
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/review");
  revalidatePath(`/dashboard/applications/${applicationId}`);
  return { message: "Email matched and the application timeline was updated.", success: true };
}

export async function dismissReviewTaskAction(
  _previousState: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  void _previousState;
  const taskId = formData.get("taskId");
  if (typeof taskId !== "string" || !uuidPattern.test(taskId)) {
    return { message: "This review task could not be identified." };
  }

  const { supabase } = await requireViewer();
  const { data, error } = await supabase.rpc("dismiss_email_review_task", {
    p_review_task_id: taskId,
  });
  if (error || !data) {
    return { message: error?.message ?? "This review task is no longer available." };
  }

  revalidatePath("/dashboard/review");
  return { message: "Marked as not job-related.", success: true };
}
