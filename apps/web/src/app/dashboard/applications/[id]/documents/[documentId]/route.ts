import { requireViewer } from "@/lib/auth";

// The link is signed when it is clicked, so it keeps working on a page left open.
export async function GET(_request: Request, { params }: {
  params: Promise<{ id: string; documentId: string }>;
}) {
  const { id, documentId } = await params;
  const { supabase, viewer } = await requireViewer();
  const { data: document, error } = await supabase.from("documents")
    .select("storage_path")
    .eq("id", documentId)
    .eq("application_id", id)
    .eq("user_id", viewer.id)
    .eq("capture_status", "COMPLETE")
    .maybeSingle();
  if (error || !document) return new Response("PDF not found", { status: 404 });
  const signed = await supabase.storage.from("job-descriptions")
    .createSignedUrl(document.storage_path, 60);
  if (signed.error || !signed.data) return new Response("PDF unavailable", { status: 502 });
  return Response.redirect(signed.data.signedUrl, 302);
}
