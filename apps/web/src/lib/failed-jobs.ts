import "server-only";

import { requireViewer } from "@/lib/auth";
import { buildFailedJobItems, type FailedJobItem } from "@/lib/failed-job-features";
import { fetchAllRows } from "@/lib/supabase/fetch-all";

export async function listFailedJobs(): Promise<FailedJobItem[]> {
  const { supabase, viewer } = await requireViewer();
  const captureResult = await fetchAllRows((from, to) => supabase
    .from("capture_jobs")
    .select("id,application_id,document_id,attempt_count,last_error,failed_at")
    .eq("user_id", viewer.id)
    .eq("status", "FAILED")
    .order("id")
    .range(from, to));
  if (captureResult.error) throw captureResult.error;

  // Read by user rather than listing every application ID: enough IDs make the
  // request too long for the server, which is refused outright.
  const applicationsResult = captureResult.data.length === 0
    ? { data: [], error: null }
    : await fetchAllRows((from, to) => supabase
        .from("applications")
        .select("id,company,position")
        .eq("user_id", viewer.id)
        .order("id")
        .range(from, to));
  if (applicationsResult.error) throw applicationsResult.error;
  return buildFailedJobItems(captureResult.data, applicationsResult.data);
}
