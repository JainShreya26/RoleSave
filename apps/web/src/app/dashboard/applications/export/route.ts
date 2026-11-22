import { isUuid } from "@rolesave/validation";
import { createApplicationWorkbook, exportDateKey, validTimeZone } from "@/lib/application-export";
import { requireViewer } from "@/lib/auth";
import { fetchAllRows } from "@/lib/supabase/fetch-all";

export async function POST(request: Request) {
  const input = await request.json().catch(() => null) as { applicationIds?: unknown; timeZone?: unknown } | null;
  const applicationIds = Array.isArray(input?.applicationIds)
    ? [...new Set(input.applicationIds.filter(isUuid))]
    : [];
  if (applicationIds.length === 0) {
    return new Response("Select at least one role to download.", { status: 400 });
  }

  const timeZone = validTimeZone(input?.timeZone);
  const selected = new Set(applicationIds);
  const { supabase, viewer } = await requireViewer();
  const { data, error } = await fetchAllRows((from, to) => supabase
    .from("applications")
    .select("id,company,position,applied_at,status,updated_at")
    .eq("user_id", viewer.id)
    .order("id")
    .range(from, to));
  if (error) {
    return new Response("Could not load the selected roles.", { status: 500 });
  }

  const applications = data
    .filter((application) => selected.has(application.id))
    .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at));
  if (applications.length !== applicationIds.length) {
    return new Response("One or more of those roles are no longer available. Reload the page and try again.", { status: 409 });
  }

  const output = await createApplicationWorkbook(applications, timeZone);
  const filename = `rolesave-applications-${exportDateKey(timeZone)}.xlsx`;
  return new Response(new Uint8Array(output), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  });
}
