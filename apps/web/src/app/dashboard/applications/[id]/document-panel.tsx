"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { retryCaptureAction, type ApplicationActionState } from "../../actions";
import { titleCase } from "@/lib/format";
import type { DocumentRow } from "@/lib/supabase/database.types";

type DocumentWithUrl = DocumentRow & { signed_url: string | null };

const initialState: ApplicationActionState = {};

export function DocumentPanel({
  applicationId,
  document,
}: {
  applicationId: string;
  document?: DocumentWithUrl;
}) {
  const router = useRouter();
  const retry = retryCaptureAction.bind(null, applicationId, document?.id ?? "");
  const [state, action, pending] = useActionState(retry, initialState);
  const processing = document?.capture_status === "PENDING" || document?.capture_status === "PROCESSING";

  useEffect(() => {
    if (!processing) return;
    const interval = window.setInterval(() => router.refresh(), 3_000);
    return () => window.clearInterval(interval);
  }, [processing, router]);

  return (
    <article className="panel side-panel document-panel">
      <h2>Job description</h2>
      {!document ? (
        <p>No captured document yet.</p>
      ) : (
        <>
          <span className={`document-badge ${document.capture_status.toLowerCase()}`}>{titleCase(document.capture_status)}</span>
          <p>
            {document.capture_status === "COMPLETE" && "Your private PDF is ready."}
            {document.capture_status === "PROCESSING" && "The worker is creating your PDF. This page updates automatically."}
            {document.capture_status === "PENDING" && "The capture is waiting for the worker. This page updates automatically."}
            {document.capture_status === "FAILED" && "The PDF could not be created."}
          </p>
          {document.signed_url && <a className="secondary-button external-link" href={document.signed_url} rel="noreferrer" target="_blank">View PDF ↗</a>}
          {document.capture_status === "FAILED" && (
            <form action={action}>
              <button className="secondary-button document-retry" disabled={pending} type="submit">{pending ? "Queuing…" : "Retry conversion"}</button>
              {state.message && <p aria-live="polite" className={state.success ? "form-message success" : "form-message error"}>{state.message}</p>}
            </form>
          )}
        </>
      )}
    </article>
  );
}
