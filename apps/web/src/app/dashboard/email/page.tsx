import { requireViewer } from "@/lib/auth";
import {
  getEmailSimulatorBaseUrl,
  getInboundEmailDomain,
  getResendApiKey,
} from "@/lib/email";
import { ForwardingConnection } from "./forwarding-connection";
import { EmailSimulator } from "./email-simulator";

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

  const { data: applications, error: applicationError } = await supabase
    .from("applications")
    .select("id,company,position,job_id")
    .eq("user_id", viewer.id)
    .order("updated_at", { ascending: false });
  if (applicationError) throw new Error(`Unable to load simulator applications: ${applicationError.message}`);

  const inboundDomain = getInboundEmailDomain();
  const localOnly = inboundDomain?.endsWith(".localhost.test") ?? false;
  const providerReady = localOnly || Boolean(getResendApiKey());
  const addressCurrent = Boolean(
    account && inboundDomain && account.email_address.toLowerCase().endsWith(`@${inboundDomain}`),
  );

  return (
    <main className="main-content email-page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Connections</p>
          <h1>Keep your ledger current from email</h1>
          <p className="intro">Start with private forwarding—no mailbox access or provider OAuth required.</p>
        </div>
      </header>

      <div className="email-content">
        <ForwardingConnection
          account={account ? { createdAt: account.created_at, emailAddress: account.email_address, id: account.id } : null}
          addressCurrent={addressCurrent}
          configured={inboundDomain !== null && providerReady}
          localOnly={localOnly}
          providerReady={providerReady}
        />

        {account && getEmailSimulatorBaseUrl() && (
          <EmailSimulator applications={applications.map((application) => ({
            company: application.company,
            id: application.id,
            jobId: application.job_id,
            position: application.position,
          }))} />
        )}

        <section className="panel forwarding-steps">
          <div className="panel-heading"><div><h2>How it works</h2><p>The parsing pipeline is being built in small, auditable stages.</p></div></div>
          <ol>
            <li><span>1</span><div><strong>Create your address</strong><p>Ledger issues a random address scoped to your account.</p></div></li>
            <li><span>2</span><div><strong>Add a forwarding rule</strong><p>Use your mail provider to send application updates to Ledger.</p></div></li>
            <li><span>3</span><div><strong>Review detected updates</strong><p>Ambiguous messages will wait for confirmation instead of changing the wrong application.</p></div></li>
          </ol>
        </section>
      </div>
    </main>
  );
}
