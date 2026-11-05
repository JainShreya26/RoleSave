import { requireViewer } from "@/lib/auth";

export async function GET(_request: Request, { params }: {
  params: Promise<{ id: string; attachmentId: string }>;
}) {
  const { id, attachmentId } = await params;
  const { supabase, viewer } = await requireViewer();
  const { data: attachment, error } = await supabase.from("application_attachments")
    .select("storage_path")
    .eq("id", attachmentId)
    .eq("application_id", id)
    .eq("user_id", viewer.id)
    .maybeSingle();
  if (error || !attachment) return new Response("File not found", { status: 404 });
  const signed = await supabase.storage.from("application-attachments")
    .createSignedUrl(attachment.storage_path, 60);
  if (signed.error || !signed.data) return new Response("File unavailable", { status: 502 });
  return Response.redirect(signed.data.signedUrl, 302);
}
