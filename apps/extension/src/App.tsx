import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import "./App.css";
import {
  captureJob,
  clearPendingApplication,
  markApplicationApplied,
  readPageMetadata,
  readPendingApplication,
  rememberPendingApplication,
  type PageMetadata,
  type PendingApplication,
} from "./capture";
import { isSupabaseConfigured, supabase } from "./supabase";

const dashboardUrl = "http://localhost:3000";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [metadata, setMetadata] = useState<PageMetadata | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const [applicationId, setApplicationId] = useState<string | null>(null);
  const [pendingApplication, setPendingApplication] = useState<PendingApplication | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [captureFailed, setCaptureFailed] = useState(false);
  const [applied, setApplied] = useState(false);
  const [messageIsError, setMessageIsError] = useState(false);
  const idempotencyKey = useRef(crypto.randomUUID());

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

  useEffect(() => {
    if (!session) return;
    void readPendingApplication()
      .then(async (pending) => {
        if (pending) {
          setPendingApplication(pending);
          setApplicationId(pending.applicationId);
          return;
        }
        setMetadata(await readPageMetadata());
      })
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Could not read this page."))
      .finally(() => setBusy(false));
  }, [session]);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setMessageIsError(false);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setMessage(error.message);
      setMessageIsError(true);
    }
    setBusy(false);
  }

  async function saveJob() {
    if (!metadata) return;
    setBusy(true);
    setCaptureFailed(false);
    setMessageIsError(false);
    setMessage("Capturing this page…");
    try {
      const id = await captureJob(metadata, idempotencyKey.current);
      const pending = await rememberPendingApplication(id, metadata);
      setApplicationId(id);
      setPendingApplication(pending);
      setJustSaved(true);
      setMessage("The PDF is being prepared in the background.");
    } catch (error) {
      setCaptureFailed(true);
      setMessageIsError(true);
      setMessage(error instanceof Error ? error.message : "The job could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function markAsApplied() {
    const id = pendingApplication?.applicationId ?? applicationId;
    if (!id) return;
    setBusy(true);
    setMessageIsError(false);
    setMessage("Updating application status…");
    try {
      await markApplicationApplied(id);
      await clearPendingApplication();
      setPendingApplication(null);
      setApplied(true);
      setMessage("Marked as applied and added to the timeline.");
    } catch (error) {
      setMessageIsError(true);
      setMessage(error instanceof Error ? error.message : "The application status could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  async function clearPending() {
    setBusy(true);
    setMessage("");
    await clearPendingApplication();
    setPendingApplication(null);
    setApplicationId(null);
    setApplied(false);
    setMetadata(null);
    idempotencyKey.current = crypto.randomUUID();
    try {
      setMetadata(await readPageMetadata());
    } catch (error) {
      setMessageIsError(true);
      setMessage(error instanceof Error ? error.message : "Could not read this page.");
    } finally {
      setBusy(false);
    }
  }

  if (!isSupabaseConfigured) {
    return <main className="popup"><p className="message error">Build the extension after configuring Supabase in apps/web/.env.local.</p></main>;
  }

  return (
    <main className="popup">
      <header className="brand-row">
        <span className="logo" aria-hidden="true"><i /><i /><i /></span>
        <div><strong>Ledger</strong><small>Application Tracker</small></div>
        {session ? <button className="text-button" onClick={() => void supabase.auth.signOut()}>Sign out</button> : null}
      </header>

      {!session ? (
        <form onSubmit={signIn}>
          <section className="page-card">
            <span className="label">Connect account</span>
            <strong>Sign in with your Ledger account</strong>
            <p>Use the same email and password as the dashboard.</p>
          </section>
          <label>Email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label>Password<input type="password" autoComplete="current-password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          <button className="primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        </form>
      ) : justSaved && pendingApplication ? (
        <>
          <section className="page-card success-card">
            <span className="label">Job description saved</span>
            <strong>{pendingApplication.company} · {pendingApplication.position}</strong>
            <p>Continue on the employer site. Open Ledger again after you submit the application.</p>
          </section>
          <button className="primary" onClick={() => window.close()}>Continue to application</button>
        </>
      ) : pendingApplication && !applied ? (
        <>
          <section className="page-card">
            <span className="label">Application in progress</span>
            <strong>{pendingApplication.company} · {pendingApplication.position}</strong>
            <p>After you submit on the employer site, return here to record it.</p>
          </section>
          <button className="primary" disabled={busy} onClick={() => void markAsApplied()}>{busy ? "Updating…" : "Mark as applied"}</button>
          <button className="pending-clear" disabled={busy} onClick={() => void clearPending()}>I’m not applying to this job</button>
        </>
      ) : applied && applicationId ? (
        <>
          <section className="page-card success-card">
            <span className="label">Application recorded</span>
            <strong>Marked as applied</strong>
            <p>The application time and timeline event were saved.</p>
          </section>
          <button className="primary" onClick={() => void chrome.tabs.create({ url: `${dashboardUrl}/dashboard/applications/${applicationId}` })}>Open saved application</button>
        </>
      ) : (
        <>
          <section className="page-card">
            <span className="label">Current page</span>
            <strong>{metadata?.title || (busy ? "Reading job page…" : "Job page")}</strong>
            <p>{metadata?.url || "Open a job posting in the active tab."}</p>
          </section>

          <label>Company<input value={metadata?.company || ""} onChange={(event) => setMetadata((value) => value ? { ...value, company: event.target.value } : value)} disabled={!metadata || busy} /></label>
          <label>Position<input value={metadata?.position || ""} onChange={(event) => setMetadata((value) => value ? { ...value, position: event.target.value } : value)} disabled={!metadata || busy} /></label>

          <button className="primary" onClick={() => void saveJob()} disabled={busy || !metadata || !metadata.company.trim() || !metadata.position.trim()}>{busy ? "Working…" : captureFailed ? "Retry save" : "Save job description"}</button>
        </>
      )}

      {message ? <p className={messageIsError ? "message" : "message success"}>{message}</p> : null}
    </main>
  );
}
