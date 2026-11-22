"use client";

import { useRouter } from "next/navigation";
import { useState, type ChangeEvent } from "react";
import { attachmentKindFromName, contentMatchesKind } from "@/lib/attachment-files";
import type { ApplicationAttachment } from "@/lib/attachments";
import { createClient } from "@/lib/supabase/client";
import { deleteAttachmentAction } from "../../attachment-actions";
import { ConfirmDialog } from "../../confirm-dialog";

const maxBytes = 6 * 1024 * 1024;

function fileSize(attachment: ApplicationAttachment) {
  return `${Math.max(1, Math.round(attachment.file_size_bytes / 1024))} KB`;
}

export function AttachmentPanel({ applicationId, attachments }: {
  applicationId: string;
  attachments: ApplicationAttachment[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [removing, setRemoving] = useState<ApplicationAttachment | null>(null);

  // Choosing a file uploads it. There is nothing else to decide, so there is no second button.
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    // Cleared straight away, so choosing the same file again after an error still counts as a change.
    input.value = "";
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
    <h2>Your files</h2>
    <p>Keep the resume or cover letter you sent for this role.</p>
    {attachments.length > 0 && <ul className="attachment-list">{attachments.map((attachment) => <li key={attachment.id}>
      <a href={`/dashboard/applications/${applicationId}/attachments/${attachment.id}`} rel="noreferrer" target="_blank">{attachment.file_name}</a>
      <small>{fileSize(attachment)}</small>
      <button aria-label={`Remove ${attachment.file_name}`} className="text-button" onClick={() => setRemoving(attachment)} type="button">Remove</button>
    </li>)}</ul>}
    {removing && <ConfirmDialog
      action={(formData) => deleteAttachmentAction(removing.id, formData)}
      confirmLabel="Remove file"
      description="This permanently removes this file from the application."
      items={[{ detail: fileSize(removing), name: removing.file_name }]}
      listLabel="File selected for removal"
      onClose={() => setRemoving(null)}
      pendingLabel="Removing…"
      title="Remove this file?"
    />}
    <div className="attachment-upload">
      <label className={`secondary-button file-button ${busy ? "busy" : ""}`}>
        <span aria-hidden="true">+</span> {busy ? "Uploading…" : "Add file"}
        <input accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" aria-label="Add a file" className="visually-hidden" disabled={busy} name="attachment" onChange={(event) => void upload(event)} type="file" />
      </label>
      <small>PDF or DOCX, up to 6 MB</small>
      {message && <p aria-live="polite" className={`form-message ${error ? "error" : "success"}`}>{message}</p>}
    </div>
  </article>;
}
