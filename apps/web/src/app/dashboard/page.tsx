import { selectableApplicationStatuses, type ApplicationStatus } from "@rolesave/types";
import Link from "next/link";
import { ApplicationCreateForm } from "./application-create-form";
import { listApplications } from "@/lib/applications";
import { formatDate, titleCase } from "@/lib/format";

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
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const selectedStatus = selectableApplicationStatuses.find((item) => item === status);
  const applications = await listApplications(selectedStatus);
  const emailUpdates = applications.reduce((total, application) => total + application.email_count, 0);
  const summary = [
    { label: selectedStatus ? "Showing" : "Total applications", value: applications.length, tone: "ink" },
    { label: "Active", value: applications.filter((item) => activeStatuses.has(item.status)).length, tone: "blue" },
    { label: "Interviews", value: applications.filter((item) => item.status === "INTERVIEW").length, tone: "green" },
    { label: "Matched emails", value: emailUpdates, tone: "blue" },
  ];

  return (
    <main className="main-content">
      <header className="topbar">
        <div><p className="eyebrow">Applications</p><h1>Your job search, in one place</h1><p className="intro">Track every role, update, and saved job description.</p></div>
        <ApplicationCreateForm />
      </header>

      <section aria-label="Application summary" className="summary-grid">
        {summary.map((item) => <article className={`summary-card ${item.tone}`} key={item.label}><span className="summary-label">{item.label}</span><strong>{item.value}</strong></article>)}
      </section>

      <section className="panel applications-panel">
        <div className="panel-heading applications-heading">
          <div><h2>{selectedStatus ? `${titleCase(selectedStatus)} applications` : "All applications"}</h2><p>Most recently updated first</p></div>
          <form className="filter-form">
            <label htmlFor="status-filter">Status</label>
            <select defaultValue={selectedStatus ?? ""} id="status-filter" name="status">
              <option value="">All statuses</option>
              {selectableApplicationStatuses.map((item) => <option key={item} value={item}>{titleCase(item)}</option>)}
            </select>
            <button className="secondary-button" type="submit">Filter</button>
            {selectedStatus && <Link className="text-link" href="/dashboard">Clear</Link>}
          </form>
        </div>
        {applications.length === 0 ? (
          <div className="empty-state"><span>▤</span><h2>No applications here yet</h2><p>{selectedStatus ? "Clear the filter to see your other applications." : "Add your first application to get started."}</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Company & role</th><th>Applied</th><th>Status</th><th>Email</th><th>JD</th><th>Updated</th></tr></thead>
              <tbody>{applications.map((application) => (
                <tr key={application.id}>
                  <td><Link className="application-name" href={`/dashboard/applications/${application.id}`}><span className="company-mark">{application.company.slice(0, 1).toUpperCase()}</span><span><strong>{application.company}</strong><small>{application.position}</small></span></Link></td>
                  <td>{formatDate(application.applied_at)}</td>
                  <td><span className={`status ${statusTone(application.status)}`}><i /> {titleCase(application.status)}</span></td>
                  <td>{application.latest_email ? (
                    <Link className="application-email-summary" href={`/dashboard/applications/${application.id}#related-emails`} title={application.latest_email.subject}>
                      <strong>{application.email_count} email{application.email_count === 1 ? "" : "s"}</strong>
                      <small>{titleCase(application.latest_email.classification)} · {formatDate(application.latest_email.received_at)}</small>
                    </Link>
                  ) : <span className="no-email-state">No email</span>}</td>
                  <td><span className={`document-state ${application.document_status === "COMPLETE" ? "ready" : "missing"}`}>{application.document_status ? titleCase(application.document_status) : "Missing"}</span></td>
                  <td><span className="updated-at">{formatDate(application.updated_at)}</span></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
