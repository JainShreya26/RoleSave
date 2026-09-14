import Link from "next/link";
import { requireViewer } from "@/lib/auth";
import { getInboundEmailDomain, getResendApiKey, isEmailSimulatorEnabled } from "@/lib/email";
import { ForwardingConnection } from "./forwarding-connection";
import { EmailSimulator } from "./email-simulator";
import { ManualEmailImport } from "./manual-email-import";

export const dynamic = "force-dynamic";

export default async function EmailConnectionPage() {
  const { supabase, viewer } = await requireViewer();
  const { data: account, error } = await supabase
    .from("email_accounts")
    .select("id,email_address,created_at")
    .eq("user_id", viewer.id)
    .eq("provider", "FORWARDING")
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load the email connection: ${error.message}`);
  }

  const inboundDomain = getInboundEmailDomain();
  const simulatorEnabled = isEmailSimulatorEnabled();
  const { data: applications = [], error: applicationError } = simulatorEnabled
    ? await supabase
        .from("applications")
        .select("id,company,position,job_id")
        .eq("user_id", viewer.id)
        .order("updated_at", { ascending: false })
    : { data: [], error: null };
  if (applicationError) throw new Error(`Unable to load test applications: ${applicationError.message}`);

  const localOnly = inboundDomain?.endsWith(".localhost.test") ?? false;
  const providerReady = localOnly || Boolean(getResendApiKey());
  const addressCurrent = Boolean(
    account && inboundDomain && account.email_address.toLowerCase().endsWith(`@${inboundDomain}`),
  );

  return (
    <main className="main-content email-page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Email setup</p>
          <h1>Update applications from email</h1>
          <p className="intro">Forward recruiting messages without connecting your mailbox.</p>
        </div>
        <Link className="secondary-button" href="/dashboard/email/activity">View email activity</Link>
      </header>

      <div className="email-content">
        <ForwardingConnection
          account={account ? { createdAt: account.created_at, emailAddress: account.email_address, id: account.id } : null}
          addressCurrent={addressCurrent}
          configured={inboundDomain !== null && providerReady}
          localOnly={localOnly}
          providerReady={providerReady}
        />

        {account && <ManualEmailImport />}

        {account && simulatorEnabled && (
          <EmailSimulator applications={(applications ?? []).map((application) => ({
            company: application.company,
            id: application.id,
            jobId: application.job_id,
            position: application.position,
          }))} />
        )}

        <section className="panel forwarding-steps">
          <div className="panel-heading"><div><h2>How it works</h2><p>Only messages you forward to RoleSave are processed.</p></div></div>
          <ol>
            <li><span>1</span><div><strong>Create your address</strong><p>RoleSave issues a random address scoped to your account.</p></div></li>
            <li><span>2</span><div><strong>Add a forwarding rule</strong><p>Use your mail provider to send application updates to RoleSave.</p></div></li>
            <li><span>3</span><div><strong>Review detected updates</strong><p>Ambiguous messages will wait for confirmation instead of changing the wrong application.</p></div></li>
          </ol>
        </section>
      </div>
    </main>
  );
}
