import { listOpenReviewTasks } from "@/lib/review-tasks";
import { IgnoredEmailCard } from "./ignored-email-card";
import { ReviewTaskCard } from "./review-task-card";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const { applications, ignoredEmails, tasks } = await listOpenReviewTasks();

  return (
    <main className="main-content review-page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Review</p>
          <h1>Needs review</h1>
          <p className="intro">Confirm uncertain matches before an application changes.</p>
        </div>
        <span className="review-count">{tasks.length} open · {ignoredEmails.length} ignored</span>
      </header>

      <section className="review-task-list">
        {tasks.length === 0 ? (
          <div className="panel empty-state">
            <span>✓</span><h2>Nothing needs review</h2><p>Ambiguous email updates will appear here.</p>
          </div>
        ) : tasks.map((task) => (
          <ReviewTaskCard applications={applications} key={task.id} task={task} />
        ))}
      </section>

      <section className="ignored-email-section">
        <div className="review-section-heading">
          <div>
            <p className="eyebrow">History</p>
            <h2>Ignored emails</h2>
          </div>
          <p>RoleSave keeps a short text preview so false negatives can be restored.</p>
        </div>
        <div className="review-task-list">
          {ignoredEmails.length === 0 ? (
            <div className="panel empty-state compact"><span>✓</span><h2>No ignored emails</h2></div>
          ) : ignoredEmails.map((email) => (
            <IgnoredEmailCard applications={applications} email={email} key={email.id} />
          ))}
        </div>
      </section>
    </main>
  );
}
