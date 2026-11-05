import { useEffect, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import "./App.css";
import { markApplicationApplied, readPageMetadata, type PageMetadata } from "./capture";
import {
  clearPendingApplication,
  findPendingForPage,
  pendingStorageKey,
  readPendingApplications,
  type PendingApplication,
} from "./pending";
import {
  connectionMessage,
  describeError,
  isConnectionError,
  readSaveAttempts,
  removeSaveAttempt,
  requestSave,
  saveAttemptsStorageKey,
  type SaveAttempt,
} from "./saves";
import { isSupabaseConfigured, supabase, webAppUrl } from "./supabase";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [metadata, setMetadata] = useState<PageMetadata | null>(null);
  const [pageError, setPageError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const [messageIsError, setMessageIsError] = useState(false);
  const [pending, setPending] = useState<PendingApplication[]>([]);
  const [attempts, setAttempts] = useState<SaveAttempt[]>([]);
  const [saved, setSaved] = useState<PendingApplication | null>(null);
  const [appliedId, setAppliedId] = useState<string | null>(null);
  const [saveFormRequested, setSaveFormRequested] = useState(false);
  const userId = session?.user.id;

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active) {
        setSession(data.session);
        if (!data.session) setBusy(false);
      }
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  // Depends on the user rather than the session, because a token refresh
  // replaces the session and must not overwrite fields the user has edited.
  useEffect(() => {
    if (!userId) return;

    void chrome.action.setBadgeText({ text: "" });
    const refreshLists = async () => {
      setPending(await readPendingApplications(userId));
      setAttempts(await readSaveAttempts(userId));
    };
    // A save keeps running after the popup closes, so a reopened popup watches
    // the background finish it.
    const onStorageChange = (changes: Record<string, unknown>, area: string) => {
      if (area === "local" && (pendingStorageKey in changes || saveAttemptsStorageKey in changes)) void refreshLists();
    };
    chrome.storage.onChanged.addListener(onStorageChange);

    void (async () => {
      await refreshLists();
      try {
        setMetadata(await readPageMetadata());
      } catch (error) {
        setPageError(error instanceof Error ? error.message : "Could not read this page.");
      }
    })().finally(() => setBusy(false));

    return () => chrome.storage.onChanged.removeListener(onStorageChange);
  }, [userId]);

  const pageAttempt = attempts.find((attempt) => attempt.url === metadata?.url);
  const pageIsSaving = pageAttempt?.status === "saving";
  const pageSaveFailed = pageAttempt?.status === "failed";
  const otherFailedAttempts = attempts.filter((attempt) => attempt.status === "failed" && attempt !== pageAttempt);

  async function signOut() {
    setPending([]);
    setAttempts([]);
    setSaved(null);
    setAppliedId(null);
    setMetadata(null);
    setPageError("");
    setMessage("");
    await supabase.auth.signOut();
  }

  async function signIn(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setMessageIsError(false);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setMessage(
        isConnectionError(error)
          ? connectionMessage
          : error.code === "email_not_confirmed"
          ? "Confirm your email address first, then sign in."
          : error.status === 429 || error.code?.startsWith("over_")
            ? "Too many attempts. Please wait a few minutes and try again."
            : "Email or password is incorrect.",
      );
      setMessageIsError(true);
      setBusy(false);
    }
  }

  async function saveJob() {
    if (!metadata) return;
    setBusy(true);
    setMessageIsError(false);
    setMessage("Capturing this page…");
    try {
      const result = await requestSave({
        company: metadata.company,
        // A retry reuses its key, so it continues the same capture session.
        idempotencyKey: pageAttempt?.idempotencyKey ?? crypto.randomUUID(),
        jobId: metadata.jobId,
        position: metadata.position,
        tabId: metadata.tabId,
        type: "rolesave.save-job",
        url: metadata.url,
      });
      if (result.ok) {
        setSaved(result.item);
        // A posting saved before already has its capture, so no new PDF is coming.
        setMessage(result.reused ? "" : "The PDF is being prepared in the background.");
      } else {
        setMessageIsError(true);
        setMessage(result.error);
      }
    } catch (error) {
      setMessageIsError(true);
      setMessage(describeError(error, "The job could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  async function markAsApplied(applicationId: string) {
    setBusy(true);
    setMessageIsError(false);
    setMessage("Updating application status…");
    try {
      const outcome = await markApplicationApplied(applicationId, supabase);
      await clearPendingApplication(applicationId);
      if (outcome === "applied") {
        setAppliedId(applicationId);
        setMessage("Marked as applied and added to the timeline.");
      } else if (outcome === "later-stage") {
        setMessage("This application is already past Applied, so nothing changed.");
      } else {
        setMessage("This application is no longer on your dashboard, so it was removed from this list.");
      }
    } catch (error) {
      setMessageIsError(true);
      setMessage(describeError(error, "The application status could not be updated."));
    } finally {
      setBusy(false);
    }
  }

  async function dismissPending(applicationId: string) {
    setBusy(true);
    setMessage("");
    await clearPendingApplication(applicationId);
    setBusy(false);
  }

  if (!isSupabaseConfigured) {
    return <main className="popup"><p className="message error">Build the extension after configuring Supabase in apps/web/.env.local.</p></main>;
  }

  const matchingPending = findPendingForPage(pending, metadata);
  // A page that may not be a job, such as a "thanks for applying" page, should
  // not push the in-progress applications aside.
  const saveFormOpen =
    pending.length === 0 ||
    Boolean(pageAttempt) ||
    (metadata !== null && (saveFormRequested || (!matchingPending && !metadata.uncertain)));
  const leadPending = matchingPending ?? (saveFormOpen ? undefined : pending[0]);
  const otherPending = pending.filter((item) => item !== leadPending);

  return (
    <main className="popup">
      <header className="brand-row">
        <span className="logo" aria-hidden="true"><i /><i /><i /></span>
        <div><strong>RoleSave</strong><small>Application Tracker</small></div>
        {session ? <button className="text-button" onClick={() => void signOut()}>Sign out</button> : null}
      </header>

      {!session ? (
        <form onSubmit={signIn}>
          <section className="page-card">
            <span className="label">Connect account</span>
            <strong>Sign in with your RoleSave account</strong>
            <p>Use the same email and password as the dashboard.</p>
          </section>
          <label>Email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label>Password<input type="password" autoComplete="current-password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          <button className="primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
          <p className="hint">
            <a href={`${webAppUrl}/auth/forgot-password`} rel="noreferrer" target="_blank">Forgot password?</a>
            {" · "}
            <a href={`${webAppUrl}/auth`} rel="noreferrer" target="_blank">Create account</a>
          </p>
        </form>
      ) : saved ? (
        <>
          <section className="page-card success-card">
            <span className="label">Job description saved</span>
            <strong>{saved.company} · {saved.position}</strong>
            <p>Continue on the employer site. Open RoleSave again after you submit the application.</p>
          </section>
          <button className="primary" onClick={() => window.close()}>Continue to application</button>
        </>
      ) : appliedId ? (
        <>
          <section className="page-card success-card">
            <span className="label">Application recorded</span>
            <strong>Marked as applied</strong>
            <p>The application time and timeline event were saved.</p>
          </section>
          <button className="primary" onClick={() => void chrome.tabs.create({ url: `${webAppUrl}/dashboard/applications/${appliedId}` })}>Open saved application</button>
          <button
            className="link-button"
            onClick={() => {
              setAppliedId(null);
              setMessage("");
            }}
          >
            Back
          </button>
        </>
      ) : (
        <>
          {leadPending ? (
            <>
              <section className="page-card">
                <span className="label">Application in progress</span>
                <strong>{leadPending.company} · {leadPending.position}</strong>
                <p>After you submit on the employer site, return here to record it.</p>
              </section>
              <button className="primary" disabled={busy} onClick={() => void markAsApplied(leadPending.applicationId)}>{busy ? "Updating…" : "Mark as applied"}</button>
              <button className="pending-clear" disabled={busy} onClick={() => void dismissPending(leadPending.applicationId)}>I’m not applying to this job</button>
            </>
          ) : null}

          {metadata && !saveFormOpen ? (
            <button className="link-button" onClick={() => setSaveFormRequested(true)}>
              {matchingPending ? "This is a different job. Save it too" : "Save this page as a new job"}
            </button>
          ) : null}

          {saveFormOpen ? (
            <>
              <section className="page-card">
                <span className="label">Current page</span>
                <strong>{metadata?.title || (busy ? "Reading job page…" : "Job page")}</strong>
                <p>{metadata?.url || "Open a job posting in the active tab."}</p>
              </section>

              {metadata?.uncertain ? (
                <p className="warning" role="status">RoleSave couldn’t confirm this is a job posting. Check the company and position before saving.</p>
              ) : null}

              <label>Company<input maxLength={200} value={metadata?.company || ""} onChange={(event) => setMetadata((value) => value ? { ...value, company: event.target.value } : value)} disabled={!metadata || busy || pageIsSaving} /></label>
              <label>Position<input maxLength={300} value={metadata?.position || ""} onChange={(event) => setMetadata((value) => value ? { ...value, position: event.target.value } : value)} disabled={!metadata || busy || pageIsSaving} /></label>

              <button className="primary" onClick={() => void saveJob()} disabled={busy || pageIsSaving || !metadata || !metadata.company.trim() || !metadata.position.trim()}>
                {pageIsSaving ? "Saving…" : busy ? "Working…" : pageSaveFailed ? "Retry save" : "Save job description"}
              </button>
              {pageSaveFailed && !message ? <p className="message error">{pageAttempt.error}</p> : null}
            </>
          ) : null}

          {pageError && pending.length === 0 ? <p className="message error">{pageError}</p> : null}

          {otherPending.length > 0 ? (
            <section className="pending-list">
              <p className="pending-list-title">{leadPending ? "Also in progress" : "In progress"}</p>
              {otherPending.map((item) => (
                <div className="page-card" key={item.applicationId}>
                  <strong>{item.company} · {item.position}</strong>
                  <div className="pending-actions">
                    <button className="mark" disabled={busy} onClick={() => void markAsApplied(item.applicationId)}>Mark as applied</button>
                    <button className="dismiss" disabled={busy} onClick={() => void dismissPending(item.applicationId)}>Not applying</button>
                  </div>
                </div>
              ))}
            </section>
          ) : null}

          {otherFailedAttempts.length > 0 ? (
            <section className="pending-list">
              <p className="pending-list-title">Not saved</p>
              {otherFailedAttempts.map((attempt) => (
                <div className="page-card" key={attempt.idempotencyKey}>
                  <strong>{attempt.company} · {attempt.position}</strong>
                  <div className="pending-actions">
                    <button className="mark" onClick={() => void chrome.tabs.create({ url: attempt.url })}>Open page</button>
                    <button className="dismiss" onClick={() => void removeSaveAttempt(attempt.idempotencyKey)}>Dismiss</button>
                  </div>
                </div>
              ))}
            </section>
          ) : null}
        </>
      )}

      {message ? <p className={messageIsError ? "message error" : "message success"}>{message}</p> : null}
    </main>
  );
}
