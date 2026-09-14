"use client";

import { useActionState, useState } from "react";
import {
  disconnectForwardingAddressAction,
  issueForwardingAddressAction,
  type EmailConnectionActionState,
} from "./actions";

interface ForwardingAccount {
  createdAt: string;
  emailAddress: string;
  id: string;
}

const initialState: EmailConnectionActionState = {};

export function ForwardingConnection({
  account,
  addressCurrent,
  configured,
  localOnly,
  providerReady,
}: {
  account: ForwardingAccount | null;
  addressCurrent: boolean;
  configured: boolean;
  localOnly: boolean;
  providerReady: boolean;
}) {
  const [issueState, issueAction, issuePending] = useActionState(issueForwardingAddressAction, initialState);
  const [disconnectState, disconnectAction, disconnectPending] = useActionState(disconnectForwardingAddressAction, initialState);
  const [copied, setCopied] = useState(false);
  const state = disconnectState.message ? disconnectState : issueState;

  async function copyAddress() {
    if (!account) return;
    await navigator.clipboard.writeText(account.emailAddress);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  if (!account) {
    return (
      <section className="panel connection-card">
        <div className="connection-icon" aria-hidden="true">@</div>
        <div>
          <p className="eyebrow">Private forwarding address</p>
          <h2>Forward application emails</h2>
          <p className="connection-description">
            Create a private RoleSave address, then forward confirmations, assessments, interviews,
            rejections, and offers from any mailbox.
          </p>
          <form action={issueAction}>
            <button className="primary-button" disabled={!configured || issuePending} type="submit">
              {issuePending ? "Creating…" : "Create forwarding address"}
            </button>
          </form>
          {!configured && <p className="form-message error">An inbound email domain must be configured before addresses can be issued.</p>}
          {state.message && <p aria-live="polite" className={`form-message ${state.success ? "success" : "error"}`}>{state.message}</p>}
        </div>
      </section>
    );
  }

  const active = addressCurrent && providerReady && !localOnly;
  const statusLabel = active ? "Active" : localOnly ? "Test only" : "Setup incomplete";
  const statusColor = active ? "green" : "amber";

  return (
    <section className={`panel connection-card ${active ? "connected" : ""}`}>
      <div className="connection-icon" aria-hidden="true">{active ? "✓" : "@"}</div>
      <div>
        <div className="connection-heading">
          <div><p className="eyebrow">{active ? "Connected" : localOnly ? "Local simulator" : "Provider setup"}</p><h2>Email forwarding</h2></div>
          <span className={`status ${statusColor}`}><i /> {statusLabel}</span>
        </div>
        <p className="connection-description">
          {active
            ? "Forward job-related messages to this private address."
            : localOnly
              ? "This address works only with the local simulator and cannot receive messages from your real mailbox."
              : !providerReady
                ? "Add the Resend API key before issuing a real forwarding address."
                : "Replace the old local address with one on the configured Resend receiving domain."}
        </p>
        <div className="forwarding-address">
          <code>{account.emailAddress}</code>
          <button className="secondary-button" onClick={copyAddress} type="button">{copied ? "Copied" : "Copy"}</button>
        </div>
        <p className="connection-created">Created {new Date(account.createdAt).toLocaleDateString()}</p>
        <div className="connection-actions">
          {!addressCurrent && (
            <form action={issueAction}>
              <button className="primary-button" disabled={!configured || issuePending} type="submit">
                {issuePending ? "Updating…" : "Create real address"}
              </button>
            </form>
          )}
          <form action={disconnectAction}>
            <input name="accountId" type="hidden" value={account.id} />
            <button className="danger-button" disabled={disconnectPending} type="submit">
              {disconnectPending ? "Disconnecting…" : "Disconnect"}
            </button>
          </form>
        </div>
        {state.message && <p aria-live="polite" className={`form-message ${state.success ? "success" : "error"}`}>{state.message}</p>}
      </div>
    </section>
  );
}
