import { listActionItems } from "@/lib/action-items";
import { jobSearchFeaturesAvailable } from "@/lib/job-search-features";
import { ActionList } from "../action-ui";

export const dynamic = "force-dynamic";

export default async function ActionsPage() {
  const featuresAvailable = await jobSearchFeaturesAvailable();
  const actions = featuresAvailable ? await listActionItems() : [];
  const open = actions.filter((item) => !item.completed_at).length;
  return <main className="main-content actions-page">
    <header className="topbar"><div><h1>Actions</h1><p className="intro">{open === 0 ? "Follow-ups and deadlines from all your roles." : `${open.toLocaleString("en-US")} open across your roles. Add one from any role's page.`}</p></div></header>
    {!featuresAvailable && <div className="notice-banner" role="status">The database update for actions is pending. Your existing roles are still available.</div>}
    {featuresAvailable && <section aria-label="All actions" className="panel actions-panel">
      <ActionList actions={actions} emptyMessage="No actions yet. Open a role and add a follow-up or a deadline." />
    </section>}
  </main>;
}
