import { selectableApplicationStatuses, type ApplicationStatus } from "@rolesave/types";
import Link from "next/link";
import { ApplicationCreateForm } from "./application-create-form";
import { listApplications } from "@/lib/applications";
import { listActionItems } from "@/lib/action-items";
import { jobSearchFeaturesAvailable } from "@/lib/job-search-features";
import { titleCase } from "@/lib/format";
import { ActionList } from "./action-ui";
import { LocalDate } from "./local-date";
import { QuickTriage } from "./quick-triage";
import { RoleFilters } from "./role-filters";

export const dynamic = "force-dynamic";

const activeStatuses = new Set<ApplicationStatus>(["APPLIED", "ASSESSMENT", "INTERVIEW"]);

function statusTone(status: ApplicationStatus) {
  return {
    APPLIED: "blue",
    ASSESSMENT: "violet",
    INTERVIEW: "green",
    NEEDS_REVIEW: "amber",
    OFFER: "green",
    REJECTED: "rose",
    SAVED: "neutral",
    WITHDRAWN: "neutral",
  }[status];
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; decision?: string }>;
}) {
  const { status, decision } = await searchParams;
  const featuresAvailable = await jobSearchFeaturesAvailable();
  const selectedStatus = selectableApplicationStatuses.find((item) => item === status);
  const selectedDecision = featuresAvailable && ["active", "unreviewed", "PURSUE", "MAYBE", "PASS", "all"].includes(decision ?? "") ? decision : featuresAvailable ? "active" : "all";
  const [applications, actions] = await Promise.all([listApplications(), featuresAvailable ? listActionItems() : Promise.resolve([])]);
  const visibleApplications = applications.filter((item) => {
    if (selectedStatus && item.status !== selectedStatus) return false;
    if (selectedDecision === "all") return true;
    if (selectedDecision === "active") return item.status !== "SAVED" || item.triage_decision !== "PASS";
    if (item.status !== "SAVED") return false;
    return selectedDecision === "unreviewed" ? item.triage_decision === null : item.triage_decision === selectedDecision;
  });
  const summary = [
    { label: "Tracked roles", value: applications.length, tone: "ink" },
    { label: featuresAvailable ? "To decide" : "Saved", value: applications.filter((item) => item.status === "SAVED" && (featuresAvailable ? item.triage_decision === null : true)).length, tone: "amber" },
    { label: "Active", value: applications.filter((item) => activeStatuses.has(item.status)).length, tone: "blue" },
    { label: "Interviews", value: applications.filter((item) => item.status === "INTERVIEW").length, tone: "green" },
  ];

  return (
    <main className="main-content">
      <header className="topbar">
        <div><p className="eyebrow">Applications</p><h1>Your job search, in one place</h1><p className="intro">Track every role, update, and saved job description.</p></div>
        <ApplicationCreateForm />
      </header>

      {!featuresAvailable && <div className="notice-banner" role="status">The database update for decisions, actions, and files is pending. Your existing roles are available below.</div>}

      <section aria-label="Application summary" className="summary-grid">
        {summary.map((item) => <article className={`summary-card ${item.tone}`} key={item.label}><span className="summary-label">{item.label}</span><strong>{item.value}</strong></article>)}
      </section>

      {featuresAvailable && <section className="panel attention-panel">
        <div className="panel-heading"><div><h2>Needs attention</h2><p>Actions due today, overdue, or ready for an in-app reminder.</p></div><Link className="text-link" href="/dashboard/actions">All actions →</Link></div>
        <ActionList actions={actions.filter((item) => !item.completed_at)} compact />
      </section>}

      <section className="panel applications-panel">
        <div className="panel-heading applications-heading">
          <div><h2>{selectedStatus ? `${titleCase(selectedStatus)} roles` : "Tracked roles"}</h2><p>Most recently updated first</p></div>
          <RoleFilters decision={selectedDecision ?? "active"} key={`${selectedStatus ?? ""}|${selectedDecision}`} showDecision={featuresAvailable} status={selectedStatus ?? ""} />
        </div>
        {visibleApplications.length === 0 ? (
          <div className="empty-state"><span>▤</span><h2>No roles here yet</h2><p>{selectedStatus || selectedDecision !== "active" ? "Clear the filters to see your other roles." : "Add your first role to get started."}</p></div>
        ) : (
          <div className="table-wrap">
            {/* The explicit roles keep this a table for screen readers when it is restyled as stacked rows. */}
            <table role="table">
              <thead role="rowgroup"><tr role="row"><th role="columnheader">Company & role</th><th role="columnheader">Applied</th><th role="columnheader">Status</th>{featuresAvailable && <th role="columnheader">Decision</th>}<th role="columnheader">JD</th><th role="columnheader">Updated</th></tr></thead>
              <tbody role="rowgroup">{visibleApplications.map((application) => (
                <tr key={application.id} role="row">
                  <td role="cell"><Link className="application-name" href={`/dashboard/applications/${application.id}`}><span className="company-mark">{application.company.slice(0, 1).toUpperCase()}</span><span><strong>{application.company}</strong><small>{application.position}</small></span></Link></td>
                  <td data-label="Applied" role="cell"><LocalDate value={application.applied_at} /></td>
                  <td data-label="Status" role="cell"><span className={`status ${statusTone(application.status)}`}><i /> {titleCase(application.status)}</span></td>
                  {featuresAvailable && <td data-label="Decision" role="cell">{application.status === "SAVED" ? <QuickTriage applicationId={application.id} company={application.company} decision={application.triage_decision} position={application.position} /> : <span className="muted-cell">—</span>}</td>}
                  <td data-label="JD" role="cell"><span className={`document-state ${application.document_status === "COMPLETE" ? "ready" : "missing"}`}>{application.document_status ? titleCase(application.document_status) : "Missing"}</span></td>
                  <td data-label="Updated" role="cell"><span className="updated-at"><LocalDate value={application.updated_at} /></span></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
