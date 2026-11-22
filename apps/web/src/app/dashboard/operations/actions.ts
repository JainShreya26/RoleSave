"use server";

import { revalidatePath } from "next/cache";
import { requireViewer } from "@/lib/auth";
import { validatedCaptureReplayId } from "@/lib/failed-job-features";

export interface RetryFailedJobActionState {
  message?: string;
  success?: boolean;
}

export async function retryFailedJobAction(
  _previousState: RetryFailedJobActionState,
  formData: FormData,
): Promise<RetryFailedJobActionState> {
  void _previousState;
  const kind = formData.get("kind");
  const replayId = validatedCaptureReplayId(kind, formData.get("replayId"));
  if (!replayId) {
    return { message: "The failed job could not be identified." };
  }

  const { supabase } = await requireViewer();
  const result = await supabase.rpc("retry_failed_capture", { p_document_id: replayId });
  if (result.error) return { message: `Unable to queue the retry: ${result.error.message}` };
  if (!result.data) {
    return { message: "This job is no longer replayable. Its source payload may have expired." };
  }

  revalidatePath("/dashboard/operations");
  return { message: "The job was returned to the queue.", success: true };
}
