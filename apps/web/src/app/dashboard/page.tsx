import Link from "next/link";
import { ApplicationCreateForm } from "./application-create-form";
import { listApplications } from "@/lib/applications";
import { listActionItems } from "@/lib/action-items";
import { jobSearchFeaturesAvailable } from "@/lib/job-search-features";
import { countActiveRoles } from "@/lib/role-list";
import { ActionList } from "./action-ui";
import { RolesPanel } from "./roles-panel";

export const dynamic = "force-dynamic";

function serverTime() {
  return Date.now();
}

// "Today" ends at most a day from now in any time zone, so an action due later cannot need attention yet.
const attentionWindow = 24 * 60 * 60 * 1000;

function roleSummary(total: number, active: number) {
  if (total === 0) return "Save a job page with the browser extension, or add a role here.";
  return `${total.toLocaleString("en-US")} ${total === 1 ? "role" : "roles"} tracked, ${active.toLocaleString("en-US")} in progress.`;
}

export default async function DashboardPage() {
  const featuresAvailable = await jobSearchFeaturesAvailable();
  const [applications, actions] = await Promise.all([listApplications(), featuresAvailable ? listActionItems() : Promise.resolve([])]);
  const renderedAt = serverTime();
  // The browser decides what is due, because only it knows the viewer's day. This just
  // leaves the panel off the page when nothing could be, which is most of the time.
  const mayNeedAttention = actions.filter((item) => !item.completed_at && (
    Date.parse(item.due_at) <= renderedAt + attentionWindow || (item.remind_at !== null && Date.parse(item.remind_at) <= renderedAt)
  ));

  return (
    <main className="main-content">
      <header className="topbar">
        <div><h1>Roles</h1><p className="intro">{roleSummary(applications.length, countActiveRoles(applications))}</p></div>
        <ApplicationCreateForm />
      </header>

      {!featuresAvailable && <div className="notice-banner" role="status">The database update for actions and files is pending. Your existing roles are available below.</div>}

      {mayNeedAttention.length > 0 && <section aria-labelledby="attention-title" className="panel attention-panel">
        <div className="panel-heading"><h2 id="attention-title">Needs attention</h2><Link className="text-link" href="/dashboard/actions">All actions →</Link></div>
        <ActionList actions={mayNeedAttention} compact />
      </section>}

      {/* Everything the table filters on is in the browser, so changing the view needs no trip to the server. */}
      <RolesPanel
        renderedAt={renderedAt}
        roles={applications.map((item) => ({
          applied_at: item.applied_at,
          company: item.company,
          document_id: item.document_id,
          document_status: item.document_status,
          id: item.id,
          original_url: item.original_url,
          position: item.position,
          status: item.status,
          updated_at: item.updated_at,
        }))}
      />
    </main>
  );
}
