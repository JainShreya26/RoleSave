import { isUuid } from "@rolesave/validation";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ApplicationEditForm, DeleteApplicationButton, StatusControl } from "./application-edit-form";
import { DocumentPanel } from "./document-panel";
import { DuplicateMergePanel } from "./duplicate-merge-panel";
import { AttachmentPanel } from "./attachment-panel";
import { getApplicationDetail } from "@/lib/applications";
import { listActionItems } from "@/lib/action-items";
import { listAttachments } from "@/lib/attachments";
import { jobSearchFeaturesAvailable } from "@/lib/job-search-features";
import { RoleActions } from "../../action-ui";
import { LocalDate } from "../../local-date";
import { eventTypeLabel, titleCase } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ApplicationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ existing?: string }>;
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const query = await searchParams;
  const featuresAvailable = await jobSearchFeaturesAvailable();
  const [{ application, applicationOptions, documents, events }, actions, attachments] = await Promise.all([
    getApplicationDetail(id),
    featuresAvailable ? listActionItems(id) : Promise.resolve([]),
    featuresAvailable ? listAttachments(id) : Promise.resolve([]),
  ]);

  return (
    <main className="main-content detail-page">
      <header className="detail-header">
        <div>
          <Link className="back-link" href="/dashboard">← Roles</Link>
          <h1>{application.company}</h1>
          <p className="intro">{application.position}</p>
        </div>
        {/* What people come here to do most: move the role along, or read the posting again. */}
        <div className="detail-header-actions">
          <StatusControl application={application} />
          {application.original_url && <a className="secondary-button" href={application.original_url} rel="noreferrer" target="_blank">View posting <span aria-hidden="true">↗</span></a>}
        </div>
      </header>

      {query.existing === "1" && (
        <div className="notice-banner" role="status">
          This posting is already tracked, so RoleSave opened the existing role instead of creating a duplicate.
        </div>
      )}

      {!featuresAvailable && <div className="notice-banner" role="status">The database update for actions and files is pending. You can still view and edit this role.</div>}

      <section className="detail-grid">
        <div className="detail-main">
          {featuresAvailable && <RoleActions actions={actions} applicationId={application.id} />}

          <article className="panel timeline-panel">
            <div className="panel-heading"><div><h2>Timeline</h2><p>Everything that has happened to this role, newest first.</p></div></div>
            {events.length === 0 ? <div className="empty-state compact"><p>No events have been recorded.</p></div> : (
              <ol className="timeline-list">
                {events.map((event) => (
                  <li key={event.id}>
                    <span className="timeline-dot" />
                    <div><strong>{eventTypeLabel(event.event_type)}</strong><p>{event.evidence ?? "No evidence recorded"}</p><small><LocalDate value={event.event_time} withTime /> · {titleCase(event.source)}</small></div>
                    {event.new_status && <span className="timeline-status">{titleCase(event.new_status)}</span>}
                  </li>
                ))}
              </ol>
            )}
          </article>

          <article className="panel">
            <div className="panel-heading"><div><h2>Role details</h2><p>Edits are recorded in the timeline.</p></div></div>
            <ApplicationEditForm application={application} />
          </article>
        </div>

        <aside className="detail-aside">
          <DocumentPanel applicationId={application.id} documents={documents} />
          {featuresAvailable && <AttachmentPanel applicationId={application.id} attachments={attachments} />}
          <article className="panel side-panel facts">
            <h2>Record</h2>
            <dl>
              <div><dt>Applied</dt><dd><LocalDate fallback={application.status === "SAVED" ? "Not yet" : "Not recorded"} value={application.applied_at} withTime /></dd></div>
              <div><dt>Added</dt><dd><LocalDate value={application.created_at} withTime /></dd></div>
              <div><dt>Updated</dt><dd><LocalDate value={application.updated_at} withTime /></dd></div>
              {application.job_id && <div><dt>Job ID</dt><dd>{application.job_id}</dd></div>}
            </dl>
          </article>
          <DuplicateMergePanel applicationId={application.id} applications={applicationOptions} />
          <article className="panel side-panel danger-zone"><h2>Delete this role</h2><p>Permanently removes its timeline, actions, files, and saved PDFs.</p><DeleteApplicationButton applicationId={application.id} name={`${application.company}, ${application.position}`} /></article>
        </aside>
      </section>
    </main>
  );
}
