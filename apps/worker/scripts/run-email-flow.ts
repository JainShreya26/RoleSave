import { randomBytes, randomUUID } from "node:crypto";
import process from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { runEmailWorkerOnce } from "../src/index";

const testCompany = "RoleSave Email Flow Test";
const testPosition = "Integration Test Engineer";
const testJobId = "ROLESAVE-EMAIL-FLOW-001";

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

/**
 * Queues a raw message exactly as the Resend poller does. RoleSave runs only on
 * this machine, so there is no HTTP endpoint in front of the queue to call.
 */
async function enqueue(
  client: SupabaseClient,
  recipient: string,
  providerMessageId: string,
  rawEmail: Buffer,
  inboundDomain: string,
) {
  const match = /^jobs\+([0-9a-f]{36})@(.+)$/.exec(recipient.trim().toLowerCase());
  if (!match || match[2] !== inboundDomain) {
    throw new Error(`${recipient} is not a RoleSave forwarding address on ${inboundDomain}.`);
  }

  const prepared = await client.rpc("prepare_inbound_email_job", {
    p_forwarding_token: match[1],
    p_provider_message_id: providerMessageId,
  });
  const job = prepared.data?.[0] as { already_queued: boolean; job_id: string; storage_path: string } | undefined;
  if (prepared.error || !job) throw prepared.error ?? new Error("Unable to prepare the email job.");
  if (job.already_queued) return { alreadyQueued: true, jobId: job.job_id };

  const upload = await client.storage.from("inbound-emails").upload(job.storage_path, rawEmail, {
    contentType: "message/rfc822",
    upsert: true,
  });
  if (upload.error) {
    await client.rpc("fail_inbound_email_upload", { p_error: upload.error.message, p_job_id: job.job_id });
    throw upload.error;
  }

  const finalized = await client.rpc("finalize_inbound_email_upload", {
    p_file_size_bytes: rawEmail.byteLength,
    p_job_id: job.job_id,
  });
  if (finalized.error || !finalized.data) {
    throw finalized.error ?? new Error("Unable to finalize the email job.");
  }
  return { alreadyQueued: false, jobId: job.job_id };
}

async function main() {
  const supabaseUrl = requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL");
  const serverKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serverKey) throw new Error("SUPABASE_SECRET_KEY is required.");

  const inboundDomain = requiredEnvironment("INBOUND_EMAIL_DOMAIN");
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

  const messageId = `${randomUUID()}@rolesave-flow.local`;
  const rawEmail = Buffer.from([
    "From: RoleSave Email Flow Test Recruiting <notifications@testcorp.example>",
    `To: ${emailAccount.email_address}`,
    `Subject: Interview availability for ${testPosition}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${messageId}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    `We would like to interview you for the ${testPosition} position.`,
    "Schedule your interview: https://calendly.com/rolesave-simulator/interview",
    `Job ID: ${testJobId}`,
    "",
  ].join("\r\n"));
  const queued = await enqueue(client, emailAccount.email_address, messageId, rawEmail, inboundDomain);
  if (queued.alreadyQueued) throw new Error("The first enqueue was unexpectedly treated as a duplicate.");

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

  const duplicate = await enqueue(client, emailAccount.email_address, messageId, rawEmail, inboundDomain);
  const rawDownload = await client.storage.from("inbound-emails").download(jobResult.data.storage_path);

  const checks = {
    applicationAutoMatched: eventResult.data.application_id === application.id,
    applicationStatus: applicationResult.data.status,
    classification: eventResult.data.classification,
    duplicateIgnored: duplicate.alreadyQueued && duplicate.jobId === queued.jobId,
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
