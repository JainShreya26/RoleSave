import { randomBytes, randomUUID } from "node:crypto";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { runEmailWorkerOnce } from "../src/index";

const testCompany = "Ledger Email Flow Test";
const testPosition = "Integration Test Engineer";
const testJobId = "LEDGER-EMAIL-FLOW-001";

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function main() {
  const supabaseUrl = requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL");
  const serverKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serverKey) throw new Error("SUPABASE_SECRET_KEY is required.");

  const inboundDomain = requiredEnvironment("INBOUND_EMAIL_DOMAIN");
  const webhookSecret = requiredEnvironment("INBOUND_EMAIL_WEBHOOK_SECRET");
  const webhookBaseUrl = process.env.EMAIL_SIMULATOR_BASE_URL?.trim() || "http://127.0.0.1:3000";
  const client = createClient(supabaseUrl, serverKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const usersResult = await client.auth.admin.listUsers({ page: 1, perPage: 100 });
  if (usersResult.error) throw usersResult.error;
  const configuredUserId = process.env.EMAIL_FLOW_USER_ID?.trim();
  const userId = configuredUserId || (usersResult.data.users.length === 1 ? usersResult.data.users[0]?.id : null);
  if (!userId) {
    throw new Error("Set EMAIL_FLOW_USER_ID when the Supabase project contains more than one user.");
  }

  let application = (await client
    .from("applications")
    .select("id,status")
    .eq("user_id", userId)
    .eq("job_id", testJobId)
    .limit(1)
    .maybeSingle()).data;

  if (!application) {
    const created = await client
      .from("applications")
      .insert({
        applied_at: new Date().toISOString(),
        company: testCompany,
        job_id: testJobId,
        position: testPosition,
        source: "MANUAL",
        status: "APPLIED",
        user_id: userId,
      })
      .select("id,status")
      .single();
    if (created.error) throw created.error;
    application = created.data;
  } else {
    const reset = await client
      .from("applications")
      .update({ status: "APPLIED" })
      .eq("id", application.id)
      .select("id,status")
      .single();
    if (reset.error) throw reset.error;
    application = reset.data;
  }

  let emailAccount = (await client
    .from("email_accounts")
    .select("id,email_address")
    .eq("user_id", userId)
    .eq("provider", "FORWARDING")
    .maybeSingle()).data;

  if (!emailAccount) {
    const token = randomBytes(18).toString("hex");
    const created = await client
      .from("email_accounts")
      .insert({
        email_address: `jobs+${token}@${inboundDomain}`,
        provider: "FORWARDING",
        provider_account_id: token,
        user_id: userId,
      })
      .select("id,email_address")
      .single();
    if (created.error) throw created.error;
    emailAccount = created.data;
  }

  const messageId = `${randomUUID()}@ledger-flow.local`;
  const rawEmail = Buffer.from([
    "From: Ledger Email Flow Test Recruiting <notifications@testcorp.example>",
    `To: ${emailAccount.email_address}`,
    `Subject: Interview availability for ${testPosition}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${messageId}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    `We would like to interview you for the ${testPosition} position.`,
    "Schedule your interview: https://calendly.com/ledger-simulator/interview",
    `Job ID: ${testJobId}`,
    "",
  ].join("\r\n"));
  const headers = {
    Authorization: `Bearer ${webhookSecret}`,
    "Content-Type": "message/rfc822",
    "X-Ledger-Recipient": emailAccount.email_address,
    "X-Provider-Message-Id": messageId,
  };

  const queuedResponse = await fetch(`${webhookBaseUrl}/api/v1/webhooks/inbound-email`, {
    body: rawEmail,
    headers,
    method: "POST",
  });
  const queued = await queuedResponse.json() as { duplicate?: boolean; error?: string; jobId?: string };
  if (queuedResponse.status !== 202 || !queued.jobId || queued.duplicate) {
    throw new Error(queued.error ?? `Webhook queueing failed with HTTP ${queuedResponse.status}.`);
  }

  const processed = await runEmailWorkerOnce(client);
  if (!processed) throw new Error("The worker did not claim the queued email.");

  const [applicationResult, eventResult, jobResult] = await Promise.all([
    client.from("applications").select("status").eq("id", application.id).single(),
    client
      .from("email_events")
      .select("application_id,classification,review_status")
      .eq("email_job_id", queued.jobId)
      .single(),
    client.from("inbound_email_jobs").select("status,storage_path").eq("id", queued.jobId).single(),
  ]);
  if (applicationResult.error || eventResult.error || jobResult.error) {
    throw applicationResult.error ?? eventResult.error ?? jobResult.error;
  }

  const duplicateResponse = await fetch(`${webhookBaseUrl}/api/v1/webhooks/inbound-email`, {
    body: rawEmail,
    headers,
    method: "POST",
  });
  const duplicate = await duplicateResponse.json() as { duplicate?: boolean; jobId?: string };
  const rawDownload = await client.storage.from("inbound-emails").download(jobResult.data.storage_path);

  const checks = {
    applicationAutoMatched: eventResult.data.application_id === application.id,
    applicationStatus: applicationResult.data.status,
    classification: eventResult.data.classification,
    duplicateIgnored: duplicateResponse.status === 202 && duplicate.duplicate === true && duplicate.jobId === queued.jobId,
    jobStatus: jobResult.data.status,
    rawEmailDeleted: Boolean(rawDownload.error),
    reviewStatus: eventResult.data.review_status,
  };
  const passed = checks.applicationAutoMatched
    && checks.applicationStatus === "INTERVIEW"
    && checks.classification === "INTERVIEW_REQUESTED"
    && checks.duplicateIgnored
    && checks.jobStatus === "COMPLETE"
    && checks.rawEmailDeleted
    && checks.reviewStatus === "NOT_REQUIRED";

  console.log(JSON.stringify({ applicationId: application.id, checks, jobId: queued.jobId, passed }, null, 2));
  if (!passed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
