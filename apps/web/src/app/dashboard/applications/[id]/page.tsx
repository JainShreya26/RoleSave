import Link from "next/link";
import { ApplicationEditForm, DeleteApplicationForm, StatusForm } from "./application-edit-form";
import { DocumentPanel } from "./document-panel";
import { getApplicationDetail } from "@/lib/applications";
import { formatDateTime, titleCase } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ApplicationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { application, documents, events } = await getApplicationDetail(id);
  const jobDescription = documents[0];

  return (
    <main className="main-content detail-page">
      <header className="detail-header">
        <div>
          <Link className="back-link" href="/dashboard">← All applications</Link>
          <p className="eyebrow">{titleCase(application.source)} record</p>
          <h1>{application.company}</h1>
          <p className="intro">{application.position}</p>
        </div>
        <span className="detail-status">{titleCase(application.status)}</span>
      </header>

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
        </div>

        <aside className="detail-aside">
          <article className="panel side-panel">
            <h2>Status</h2>
            <StatusForm application={application} />
          </article>
          <DocumentPanel applicationId={application.id} document={jobDescription} />
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
