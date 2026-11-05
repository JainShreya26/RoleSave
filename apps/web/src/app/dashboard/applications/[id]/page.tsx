import { isUuid } from "@rolesave/validation";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ApplicationEditForm, DeleteApplicationForm, StatusForm } from "./application-edit-form";
import { DocumentPanel } from "./document-panel";
import { DuplicateMergePanel } from "./duplicate-merge-panel";
import { TriagePanel } from "./triage-panel";
import { AttachmentPanel } from "./attachment-panel";
import { getApplicationDetail } from "@/lib/applications";
import { listActionItems } from "@/lib/action-items";
import { listAttachments } from "@/lib/attachments";
import { jobSearchFeaturesAvailable } from "@/lib/job-search-features";
import { ActionForm, ActionList } from "../../action-ui";
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
    getApplicationDetail(id, featuresAvailable),
    featuresAvailable ? listActionItems(id) : Promise.resolve([]),
    featuresAvailable ? listAttachments(id) : Promise.resolve([]),
  ]);

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
        </div>
      </header>

      {query.existing === "1" && (
        <div className="notice-banner" role="status">
          This posting is already tracked, so RoleSave opened the existing application instead of creating a duplicate.
        </div>
      )}

      {!featuresAvailable && <div className="notice-banner" role="status">The database update for decisions, actions, and files is pending. You can still view and edit this role.</div>}

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
                    <div><strong>{eventTypeLabel(event.event_type)}</strong><p>{event.evidence ?? "No evidence recorded"}</p><small><LocalDate value={event.event_time} withTime /> · {titleCase(event.source)}</small></div>
                    {event.new_status && <span className="timeline-status">{titleCase(event.new_status)}</span>}
                  </li>
                ))}
              </ol>
            )}
          </article>
          {featuresAvailable && <article className="panel role-actions-panel">
            <div className="panel-heading"><div><h2>Next actions</h2><p>Plan the follow-ups and deadlines for this role.</p></div></div>
            <div className="role-actions-content"><ActionList actions={actions} emptyMessage="No actions yet. Add the first one below." /><h3>Add an action</h3><ActionForm applicationId={application.id} /></div>
          </article>}
        </div>

        <aside className="detail-aside">
          {featuresAvailable && <TriagePanel application={application} />}
          <article className="panel side-panel">
            <h2>Status</h2>
            <StatusForm application={application} />
          </article>
          <DocumentPanel applicationId={application.id} documents={documents} />
          {featuresAvailable && <AttachmentPanel applicationId={application.id} attachments={attachments} />}
          <DuplicateMergePanel applicationId={application.id} applications={applicationOptions} />
          <article className="panel side-panel facts">
            <h2>Record</h2>
            <dl>
              <div><dt>Applied</dt><dd><LocalDate value={application.applied_at} withTime /></dd></div>
              <div><dt>Created</dt><dd><LocalDate value={application.created_at} withTime /></dd></div>
              <div><dt>Updated</dt><dd><LocalDate value={application.updated_at} withTime /></dd></div>
              <div><dt>Job ID</dt><dd>{application.job_id ?? "Not recorded"}</dd></div>
            </dl>
            {application.original_url && <a className="secondary-button external-link" href={application.original_url} rel="noreferrer" target="_blank">Open original page ↗</a>}
          </article>
          <article className="panel side-panel danger-zone"><h2>Danger zone</h2><p>Deleting permanently removes the timeline, actions, files, temporary captures, and stored PDFs.</p><DeleteApplicationForm applicationId={application.id} /></article>
        </aside>
      </section>
    </main>
  );
}
