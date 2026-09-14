"use server";

import { revalidatePath } from "next/cache";
import { requireViewer } from "@/lib/auth";

export interface RetryFailedJobActionState {
  message?: string;
  success?: boolean;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function retryFailedJobAction(
  _previousState: RetryFailedJobActionState,
  formData: FormData,
): Promise<RetryFailedJobActionState> {
  void _previousState;
  const kind = formData.get("kind");
  const replayId = formData.get("replayId");
  if ((kind !== "CAPTURE" && kind !== "EMAIL") || typeof replayId !== "string" || !uuidPattern.test(replayId)) {
    return { message: "The failed job could not be identified." };
  }

  const { supabase } = await requireViewer();
  const result = kind === "CAPTURE"
    ? await supabase.rpc("retry_failed_capture", { p_document_id: replayId })
    : await supabase.rpc("retry_failed_email_job", { p_job_id: replayId });
  if (result.error) return { message: `Unable to queue the retry: ${result.error.message}` };
  if (!result.data) {
    return { message: "This job is no longer replayable. Its source payload may have expired." };
  }

  revalidatePath("/dashboard/operations");
  return { message: "The job was returned to the queue.", success: true };
}
