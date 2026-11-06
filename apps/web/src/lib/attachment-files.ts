export interface AttachmentKind {
  extension: "pdf" | "docx";
  mimeType: string;
}

/** The kind of file a name claims to be, when it is one we accept. */
export function attachmentKindFromName(fileName: string): AttachmentKind | null {
  const name = fileName.toLowerCase();
  if (name.endsWith(".pdf")) return { extension: "pdf", mimeType: "application/pdf" };
  if (name.endsWith(".docx")) {
    return {
      extension: "docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
  }
  return null;
}

/**
 * Whether a file's contents match the kind its name claims, which catches a
 * renamed file. A PDF has its marker near the start, though not always at the
 * very first byte. A DOCX is a zip that stores the names of its parts as plain
 * text, so they can be found without unpacking it.
 *
 * This runs in the browser to help the person uploading. It is not a security
 * check: the browser talks to storage directly, so it can be skipped, but only
 * for files in that person's own private folder.
 */
export function contentMatchesKind(kind: AttachmentKind, bytes: Uint8Array) {
  const text = new TextDecoder("latin1").decode(bytes);
  if (kind.extension === "pdf") return text.slice(0, 1024).includes("%PDF-");
  return text.startsWith("PK\u0003\u0004") && text.includes("[Content_Types].xml") && text.includes("word/");
}
