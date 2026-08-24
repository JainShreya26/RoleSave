import { listOpenReviewTasks } from "@/lib/review-tasks";
import { ReviewTaskCard } from "./review-task-card";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const { applications, tasks } = await listOpenReviewTasks();

  return (
    <main className="main-content review-page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Human in the loop</p>
          <h1>Needs review</h1>
          <p className="intro">Confirm ambiguous email matches before they change an application.</p>
        </div>
        <span className="review-count">{tasks.length} open</span>
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
    </main>
  );
}
