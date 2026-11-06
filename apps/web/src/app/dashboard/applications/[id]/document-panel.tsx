"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { retryCaptureAction, type ApplicationActionState } from "../../actions";
import { LocalDate } from "../../local-date";
import { titleCase } from "@/lib/format";
import type { ApplicationDocumentItem } from "@/lib/applications";

const initialState: ApplicationActionState = {};

function stateMessage(latest: ApplicationDocumentItem, hasPdf: boolean) {
  switch (latest.capture_status) {
    case "COMPLETE":
      return latest.pdf_available ? "Your private PDF is ready." : "The PDF could not be opened. Reload this page to try again.";
    case "PROCESSING":
      return "The worker is creating your PDF. This page updates automatically.";
    case "PENDING":
      return "The capture is waiting for the worker. This page updates automatically.";
    case "FAILED":
      return hasPdf ? "The latest capture could not be converted, but an earlier PDF is still available." : "The PDF could not be created.";
  }
}

export function DocumentPanel({
  applicationId,
  documents,
}: {
  applicationId: string;
  documents: ApplicationDocumentItem[];
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(retryCaptureAction, initialState);
  const latest = documents[0];
  const pdfs = documents.filter((document) => document.pdf_available);
  const processing = documents.some((document) => document.capture_status === "PENDING" || document.capture_status === "PROCESSING");

  useEffect(() => {
    if (!processing) return;
    const interval = window.setInterval(() => router.refresh(), 3_000);
    return () => window.clearInterval(interval);
  }, [processing, router]);

  return (
    <article className="panel side-panel document-panel">
      <h2>Job description</h2>
      {!latest ? (
        <p>No captured document yet.</p>
      ) : (
        <>
          <span className={`document-badge ${latest.capture_status.toLowerCase()}`}>{titleCase(latest.capture_status)}</span>
          <p>{stateMessage(latest, pdfs.length > 0)}</p>
          {pdfs.length > 0 && (
            <div className="document-links">
              {pdfs.map((pdf) => (
                <a className="secondary-button external-link" href={`/dashboard/applications/${applicationId}/documents/${pdf.id}`} key={pdf.id} rel="noreferrer" target="_blank">
                  <span>View PDF{pdfs.length > 1 && <> · <LocalDate value={pdf.saved_at} withTime /></>} ↗</span>
                </a>
              ))}
            </div>
          )}
          {latest.capture_status === "FAILED" && (
            <form action={action}>
              <input name="applicationId" type="hidden" value={applicationId} />
              <input name="documentId" type="hidden" value={latest.id} />
              <button className="secondary-button document-retry" disabled={pending} type="submit">{pending ? "Queuing…" : "Retry conversion"}</button>
              {state.message && <p aria-live="polite" className={state.success ? "form-message success" : "form-message error"}>{state.message}</p>}
            </form>
          )}
        </>
      )}
    </article>
  );
}
