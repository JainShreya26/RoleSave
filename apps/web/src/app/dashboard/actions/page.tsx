import Link from "next/link";
import { listActionItems } from "@/lib/action-items";
import { jobSearchFeaturesAvailable } from "@/lib/job-search-features";
import { ActionList } from "../action-ui";

export const dynamic = "force-dynamic";

export default async function ActionsPage() {
  const featuresAvailable = await jobSearchFeaturesAvailable();
  const actions = featuresAvailable ? await listActionItems() : [];
  return <main className="main-content actions-page">
    <header className="topbar"><div><p className="eyebrow">Your next steps</p><h1>Actions</h1><p className="intro">Due dates and reminders appear here while RoleSave is open.</p></div><Link className="secondary-button" href="/dashboard">View roles</Link></header>
    {!featuresAvailable && <div className="notice-banner" role="status">The database update for actions is pending. Your existing roles are still available.</div>}
    {featuresAvailable && <section className="panel actions-panel">
      <div className="panel-heading"><div><h2>All actions</h2><p>Complete, edit, or reschedule an action at any time.</p></div></div>
      <ActionList actions={actions} />
    </section>}
  </main>;
}
