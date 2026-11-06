import "server-only";

import { requireViewer } from "@/lib/auth";
import type { Database } from "@/lib/supabase/database.types";
import { fetchAllRows } from "@/lib/supabase/fetch-all";

export type ApplicationAttachment = Pick<
  Database["public"]["Tables"]["application_attachments"]["Row"],
  "id" | "application_id" | "file_name" | "file_size_bytes" | "created_at"
>;

export async function listAttachments(applicationId: string): Promise<ApplicationAttachment[]> {
  const { supabase, viewer } = await requireViewer();
  const { data, error } = await fetchAllRows((from, to) => supabase.from("application_attachments")
    .select("id,application_id,file_name,file_size_bytes,created_at")
    .eq("application_id", applicationId)
    .eq("user_id", viewer.id)
    .order("created_at", { ascending: false })
    .order("id")
    .range(from, to));
  if (error) throw new Error(`Unable to load application files: ${error.message}`);
  return data;
}
