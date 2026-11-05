"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { attachmentKindFromName, contentMatchesKind } from "@/lib/attachment-files";
import type { ApplicationAttachment } from "@/lib/attachments";
import { createClient } from "@/lib/supabase/client";
import { deleteAttachmentAction } from "../../attachment-actions";

const maxBytes = 6 * 1024 * 1024;

export function AttachmentPanel({ applicationId, attachments }: {
  applicationId: string;
  attachments: ApplicationAttachment[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements.namedItem("attachment") as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) return;
    const type = attachmentKindFromName(file.name);
    if (!type || file.size < 1 || file.size > maxBytes) {
      setError(true);
      setMessage("Choose a PDF or DOCX file up to 6 MB.");
      return;
    }
    setBusy(true);
    setMessage("");
    setError(false);
    const supabase = createClient();
    try {
      if (!contentMatchesKind(type, new Uint8Array(await file.arrayBuffer()))) {
        throw new Error(`This file isn't a readable ${type.extension.toUpperCase()}. Try exporting it again.`);
      }
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) throw new Error("Sign in again before uploading.");
      const storagePath = `${auth.user.id}/${crypto.randomUUID()}.${type.extension}`;
      const uploadResult = await supabase.storage.from("application-attachments")
        .upload(storagePath, file, { contentType: type.mimeType, upsert: false });
      if (uploadResult.error) throw uploadResult.error;

      const fileName = file.name.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255) || `document.${type.extension}`;
      const saved = await supabase.from("application_attachments").insert({
        application_id: applicationId,
        user_id: auth.user.id,
        file_name: fileName,
        file_size_bytes: file.size,
        mime_type: type.mimeType,
        storage_path: storagePath,
      });
      if (saved.error) {
        await supabase.storage.from("application-attachments").remove([storagePath]);
        throw saved.error;
      }
      form.reset();
      setMessage("File added.");
      router.refresh();
    } catch (cause) {
      setError(true);
      setMessage(cause instanceof Error ? cause.message : "The file could not be uploaded.");
    } finally {
      setBusy(false);
    }
  }

  return <article className="panel side-panel attachment-panel">
    <h2>Application files</h2>
    <p>Optionally keep the resume or other document you submitted with this role.</p>
    {attachments.length > 0 && <ul className="attachment-list">{attachments.map((attachment) => <li key={attachment.id}>
      <a href={`/dashboard/applications/${applicationId}/attachments/${attachment.id}`} rel="noreferrer" target="_blank">{attachment.file_name}</a>
      <small>{Math.max(1, Math.round(attachment.file_size_bytes / 1024))} KB</small>
      <form action={deleteAttachmentAction.bind(null, attachment.id)} onSubmit={(event) => {
        if (!window.confirm(`Remove “${attachment.file_name}”?`)) event.preventDefault();
      }}><button aria-label={`Remove ${attachment.file_name}`} className="text-button" type="submit">Remove</button></form>
    </li>)}</ul>}
    <form className="stack-form attachment-upload" onSubmit={(event) => void upload(event)}>
      <label>Choose a file<input accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" name="attachment" required type="file" /></label>
      <small>PDF or DOCX · 6 MB maximum</small>
      <button className="secondary-button" disabled={busy} type="submit">{busy ? "Uploading…" : "Add file"}</button>
      {message && <p aria-live="polite" className={`form-message ${error ? "error" : "success"}`}>{message}</p>}
    </form>
  </article>;
}
