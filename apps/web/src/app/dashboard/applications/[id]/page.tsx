import Link from "next/link";
import { ApplicationEditForm, DeleteApplicationForm, StatusForm } from "./application-edit-form";
import { DocumentPanel } from "./document-panel";
import { RelatedEmailsPanel } from "./related-emails-panel";
import { DuplicateMergePanel } from "./duplicate-merge-panel";
import { getApplicationDetail } from "@/lib/applications";
import { formatDateTime, titleCase } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ApplicationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ existing?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const { application, applicationOptions, document, events, relatedEmails } = await getApplicationDetail(id);

  return (
    <main className="main-content detail-page">
      <header className="detail-header">
        <div>
          <Link className="back-link" href="/dashboard">← All applications</Link>
          <p className="eyebrow">Application</p>
          <h1>{application.company}</h1>
          <p className="intro">{application.position}</p>
        </div>
        <div className="detail-badges">
          <span className="detail-status">{titleCase(application.status)}</span>
          <a className="detail-email-badge" href="#related-emails">
            {relatedEmails.length} related email{relatedEmails.length === 1 ? "" : "s"}
          </a>
        </div>
      </header>

      {query.existing === "1" && (
        <div className="notice-banner" role="status">
          This posting is already tracked, so RoleSave opened the existing application instead of creating a duplicate.
        </div>
      )}

      <section className="detail-grid">
        <div className="detail-main">
          <article className="panel">
            <div className="panel-heading"><div><h2>Application details</h2><p>Edits are recorded in the timeline.</p></div></div>
            <ApplicationEditForm application={application} />
          </article>

          <article className="panel timeline-panel">
            <div className="panel-heading"><div><h2>Timeline</h2><p>Evidence behind every update.</p></div></div>
            {events.length === 0 ? <div className="empty-state compact"><p>No events have been recorded.</p></div> : (
              <ol className="timeline-list">
                {events.map((event) => (
                  <li key={event.id}>
                    <span className="timeline-dot" />
                    <div><strong>{titleCase(event.event_type)}</strong><p>{event.evidence ?? "No evidence recorded"}</p><small>{formatDateTime(event.event_time)} · {titleCase(event.source)}</small></div>
                    {event.new_status && <span className="timeline-status">{titleCase(event.new_status)}</span>}
                  </li>
                ))}
              </ol>
            )}
          </article>

          <RelatedEmailsPanel
            applicationId={application.id}
            applications={applicationOptions}
            emails={relatedEmails}
          />
        </div>

        <aside className="detail-aside">
          <article className="panel side-panel">
            <h2>Status</h2>
            <StatusForm application={application} />
          </article>
          <DocumentPanel applicationId={application.id} document={document} />
          <DuplicateMergePanel applicationId={application.id} applications={applicationOptions} />
          <article className="panel side-panel facts">
            <h2>Record</h2>
            <dl>
              <div><dt>Applied</dt><dd>{formatDateTime(application.applied_at)}</dd></div>
              <div><dt>Created</dt><dd>{formatDateTime(application.created_at)}</dd></div>
              <div><dt>Updated</dt><dd>{formatDateTime(application.updated_at)}</dd></div>
              <div><dt>Job ID</dt><dd>{application.job_id ?? "Not recorded"}</dd></div>
            </dl>
            {application.original_url && <a className="secondary-button external-link" href={application.original_url} rel="noreferrer" target="_blank">Open original page ↗</a>}
          </article>
          <article className="panel side-panel danger-zone"><h2>Danger zone</h2><p>Deleting permanently removes the timeline, temporary capture, and stored PDF.</p><DeleteApplicationForm applicationId={application.id} /></article>
        </aside>
      </section>
    </main>
  );
}
