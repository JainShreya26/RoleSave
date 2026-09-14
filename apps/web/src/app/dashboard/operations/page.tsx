import { listFailedJobs } from "@/lib/failed-jobs";
import { FailedJobCard } from "./failed-job-card";

export const dynamic = "force-dynamic";

export default async function OperationsPage() {
  const jobs = await listFailedJobs();

  return (
    <main className="main-content operations-page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Processing</p>
          <h1>Processing issues</h1>
          <p className="intro">Retry email or PDF work that could not finish automatically.</p>
        </div>
        <span className="review-count">{jobs.length} failed</span>
      </header>

      <section className="failed-job-list">
        {jobs.length === 0 ? (
          <div className="panel empty-state">
            <span>✓</span><h2>No failed jobs</h2><p>Jobs that exhaust automatic retries will appear here.</p>
          </div>
        ) : jobs.map((job) => <FailedJobCard job={job} key={`${job.kind}-${job.id}`} />)}
      </section>
    </main>
  );
}
