import Link from "next/link";
import {
  emailActivityStates,
  listEmailActivity,
  type EmailActivityState,
} from "@/lib/email-activity";
import { formatDateTime, titleCase } from "@/lib/format";

export const dynamic = "force-dynamic";

function isActivityFilter(value: string | undefined): value is typeof emailActivityStates[number] {
  return emailActivityStates.includes(value as typeof emailActivityStates[number]);
}

function stateTone(state: EmailActivityState) {
  return {
    FAILED: "rose",
    IGNORED: "neutral",
    MATCHED: "green",
    NEEDS_REVIEW: "amber",
    PROCESSING: "violet",
    RECEIVED: "blue",
  }[state];
}

function stateDescription(state: EmailActivityState) {
  return {
    FAILED: "Processing stopped after the available attempts.",
    IGNORED: "No application was changed. You can restore this from Needs Review.",
    MATCHED: "The email is attached to the application shown below.",
    NEEDS_REVIEW: "RoleSave is waiting for you to choose the correct application.",
    PROCESSING: "The worker is parsing and classifying this message.",
    RECEIVED: "The message reached RoleSave and is waiting to be processed.",
  }[state];
}

export default async function EmailActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const { state: requestedState } = await searchParams;
  const selectedState = isActivityFilter(requestedState) ? requestedState : "ALL";
  const activity = await listEmailActivity();
  const visibleActivity = selectedState === "ALL"
    ? activity
    : activity.filter((item) => item.state === selectedState);
  const counts = Object.fromEntries(emailActivityStates.map((state) => [
    state,
    state === "ALL" ? activity.length : activity.filter((item) => item.state === state).length,
  ])) as Record<typeof emailActivityStates[number], number>;

  return (
    <main className="main-content email-activity-page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Email</p>
          <h1>Email activity</h1>
          <p className="intro">See what happened to every message you forwarded.</p>
        </div>
        <Link className="secondary-button" href="/dashboard/email">Email connection</Link>
      </header>

      <section className="email-activity-summary" aria-label="Email activity summary">
        {emailActivityStates.filter((state) => state !== "ALL").map((state) => (
          <Link
            className={`email-activity-summary-card ${selectedState === state ? "active" : ""}`}
            href={`/dashboard/email/activity?state=${state}`}
            key={state}
          >
            <span>{titleCase(state)}</span><strong>{counts[state]}</strong>
          </Link>
        ))}
      </section>

      <section className="panel email-activity-panel">
        <div className="panel-heading applications-heading">
          <div><h2>Received messages</h2><p>{visibleActivity.length} shown out of {activity.length} recent messages.</p></div>
          <form className="filter-form">
            <label htmlFor="email-state-filter">State</label>
            <select defaultValue={selectedState} id="email-state-filter" name="state">
              {emailActivityStates.map((state) => (
                <option key={state} value={state}>{titleCase(state)} ({counts[state]})</option>
              ))}
            </select>
            <button className="secondary-button" type="submit">Filter</button>
          </form>
        </div>

        {visibleActivity.length === 0 ? (
          <div className="empty-state"><span>@</span><h2>No email in this state</h2><p>Try another filter or check the forwarding connection.</p></div>
        ) : (
          <div className="email-activity-list">
            {visibleActivity.map((item) => (
              <article className="email-activity-item" key={item.id}>
                <div className="email-activity-item-heading">
                  <span className={`status ${stateTone(item.state)}`}><i />{titleCase(item.state)}</span>
                  <time>{formatDateTime(item.occurredAt)}</time>
                </div>
                <div className="email-activity-copy">
                  <h3>{item.subject}</h3>
                  <p>{item.sender ? `From ${item.sender}` : "Sender will appear after parsing."}</p>
                  <small>{stateDescription(item.state)}</small>
                </div>
                {item.classification && (
                  <dl className="email-activity-facts">
                    <div><dt>Detected event</dt><dd>{titleCase(item.classification)}</dd></div>
                    <div><dt>Attempts</dt><dd>{item.attemptCount}</dd></div>
                  </dl>
                )}
                {item.evidence && <blockquote>{item.evidence}</blockquote>}
                {item.lastError && <p className="failed-job-error">{item.lastError}</p>}
                <div className="email-activity-actions">
                  {item.application && (
                    <Link className="secondary-button" href={`/dashboard/applications/${item.application.id}`}>
                      {item.application.company} — {item.application.position}
                    </Link>
                  )}
                  {item.state === "NEEDS_REVIEW" && <Link className="primary-button" href="/dashboard/review">Review match</Link>}
                  {item.state === "IGNORED" && <Link className="secondary-button" href="/dashboard/review">View ignored email</Link>}
                  {item.state === "FAILED" && <Link className="secondary-button" href="/dashboard/operations">Retry processing</Link>}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
