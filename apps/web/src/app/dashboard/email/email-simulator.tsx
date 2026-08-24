"use client";

import { useActionState } from "react";
import { titleCase } from "@/lib/format";
import { simulateInboundEmailAction, type EmailConnectionActionState } from "./actions";

interface ApplicationOption {
  company: string;
  id: string;
  jobId: string | null;
  position: string;
}

const initialState: EmailConnectionActionState = {};
const scenarios = ["APPLICATION_CONFIRMED", "ASSESSMENT_REQUESTED", "INTERVIEW_REQUESTED", "REJECTION_RECEIVED", "OFFER_RECEIVED"];

export function EmailSimulator({ applications }: { applications: ApplicationOption[] }) {
  const [state, action, pending] = useActionState(simulateInboundEmailAction, initialState);

  return (
    <section className="panel email-simulator">
      <div className="panel-heading">
        <div><h2>Local flow simulator</h2><p>Development only—no email provider or domain required.</p></div>
        <span className="status violet"><i /> Test mode</span>
      </div>
      <form action={action} className="simulator-form">
        <label>Application
          <select disabled={applications.length === 0} name="applicationId" required>
            {applications.map((application) => (
              <option key={application.id} value={application.id}>
                {application.company} — {application.position}{application.jobId ? ` · ${application.jobId}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label>Email event
          <select defaultValue="APPLICATION_CONFIRMED" name="scenario">
            {scenarios.map((scenario) => <option key={scenario} value={scenario}>{titleCase(scenario)}</option>)}
          </select>
        </label>
        <button className="primary-button" disabled={pending || applications.length === 0} type="submit">
          {pending ? "Sending…" : "Send test email"}
        </button>
      </form>
      {applications.length === 0 && <p className="form-message error">Add an application before running the simulator.</p>}
      <p className="simulator-note">Applications with a job ID should auto-match. Applications without one may be routed to Needs review.</p>
      {state.message && <p aria-live="polite" className={`form-message ${state.success ? "success" : "error"}`}>{state.message}</p>}
    </section>
  );
}
