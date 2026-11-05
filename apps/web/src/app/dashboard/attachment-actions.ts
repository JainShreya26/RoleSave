"use server";

import { refresh, revalidatePath } from "next/cache";
import { requireViewer } from "@/lib/auth";

export async function deleteAttachmentAction(attachmentId: string, _formData: FormData) {
  void _formData;
  const { supabase, viewer } = await requireViewer();
  const { data: attachment, error: lookupError } = await supabase
    .from("application_attachments")
    .select("application_id,storage_path")
    .eq("id", attachmentId)
    .eq("user_id", viewer.id)
    .maybeSingle();
  if (lookupError) throw new Error(`Unable to find the file: ${lookupError.message}`);
  // Already removed, perhaps in another tab, so just show the current list.
  if (!attachment) {
    refresh();
    return;
  }

  const removal = await supabase.storage.from("application-attachments").remove([attachment.storage_path]);
  if (removal.error) throw new Error(`Unable to remove file: ${removal.error.message}`);
  const { error } = await supabase.from("application_attachments")
    .delete().eq("id", attachmentId).eq("user_id", viewer.id);
  if (error) throw new Error(`File removed, but its record could not be deleted: ${error.message}`);
  revalidatePath(`/dashboard/applications/${attachment.application_id}`);
}
