import { Buffer } from "node:buffer";
import { Resend, type GetReceivingEmailResponseSuccess, type ListReceivingEmail } from "resend";
import type { SupabaseClient } from "@supabase/supabase-js";

const maximumRawEmailBytes = 10 * 1024 * 1024;

function extractForwardingToken(recipient: string, expectedDomain: string) {
  const match = /^jobs\+([0-9a-f]{36})@(.+)$/.exec(recipient.trim().toLowerCase());
  if (!match || match[2] !== expectedDomain) return null;
  return match[1];
}

export function findResendForwardingRecipient(email: Pick<ListReceivingEmail, "received_for" | "to">, domain: string) {
  return [...new Set([...(email.to ?? []), ...(email.received_for ?? [])])]
    .find((recipient) => extractForwardingToken(recipient, domain));
}

function safeHeader(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function fallbackRawEmail(email: GetReceivingEmailResponseSuccess) {
  const content = email.text ?? email.html ?? "";
  const contentType = email.text ? "text/plain" : "text/html";
  return Buffer.from([
    `From: ${safeHeader(email.from)}`,
    `To: ${email.to.map(safeHeader).join(", ")}`,
    `Subject: ${safeHeader(email.subject)}`,
    `Date: ${new Date(email.created_at).toUTCString()}`,
    `Message-ID: ${safeHeader(email.message_id)}`,
    "MIME-Version: 1.0",
    `Content-Type: ${contentType}; charset=utf-8`,
    "Content-Transfer-Encoding: 8bit",
    "",
    content,
    "",
  ].join("\r\n"));
}

async function readBodyWithLimit(response: Response) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumRawEmailBytes) {
    throw new Error("Raw email exceeds the 10 MB limit.");
  }
  if (!response.body) throw new Error("Resend returned an empty raw email response.");

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maximumRawEmailBytes) {
      await reader.cancel();
      throw new Error("Raw email exceeds the 10 MB limit.");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, totalBytes);
}

async function downloadRawEmail(email: GetReceivingEmailResponseSuccess) {
  const downloadUrl = email.raw?.download_url;
  if (!downloadUrl) return fallbackRawEmail(email);

  const url = new URL(downloadUrl);
  const resendHost = ["resend.com", "resend.app"].some((domain) => (
    url.hostname === domain || url.hostname.endsWith(`.${domain}`)
  ));
  if (url.protocol !== "https:" || !resendHost) {
    throw new Error("Resend returned an unexpected raw email URL.");
  }

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to download the raw email (HTTP ${response.status}).`);
  return readBodyWithLimit(response);
}

async function queueReceivedEmail(
  emailSummary: ListReceivingEmail,
  recipient: string,
  inboundDomain: string,
  client: SupabaseClient,
  resend: Resend,
) {
  const forwardingToken = extractForwardingToken(recipient, inboundDomain);
  if (!forwardingToken) return false;
  const providerMessageId = `resend:${emailSummary.id}`;
  const prepared = await client.rpc("prepare_inbound_email_job", {
    p_forwarding_token: forwardingToken,
    p_provider_message_id: providerMessageId,
  });
  const job = prepared.data?.[0] as { already_queued: boolean; job_id: string; storage_path: string } | undefined;
  if (prepared.error || !job) throw prepared.error ?? new Error("Unable to prepare the Resend email job.");
  if (job.already_queued) return false;

  try {
    const received = await resend.emails.receiving.get(emailSummary.id, { html_format: "cid" });
    if (received.error || !received.data) {
      throw received.error ?? new Error("Unable to retrieve the received email from Resend.");
    }
    const rawEmail = await downloadRawEmail(received.data);
    if (rawEmail.byteLength < 1) throw new Error("Resend returned an empty raw email.");

    const upload = await client.storage.from("inbound-emails").upload(job.storage_path, rawEmail, {
      contentType: "message/rfc822",
      upsert: true,
    });
    if (upload.error) throw upload.error;

    const finalized = await client.rpc("finalize_inbound_email_upload", {
      p_file_size_bytes: rawEmail.byteLength,
      p_job_id: job.job_id,
    });
    if (finalized.error || !finalized.data) {
      throw finalized.error ?? new Error("Unable to finalize the Resend email job.");
    }
    return true;
  } catch (error) {
    await client.rpc("fail_inbound_email_upload", {
      p_error: error instanceof Error ? error.message : String(error),
      p_job_id: job.job_id,
    });
    throw error;
  }
}

export async function pollResendInbox(client: SupabaseClient, resend: Resend, inboundDomain: string) {
  const [listed, existing] = await Promise.all([
    resend.emails.receiving.list({ limit: 100 }),
    client
      .from("inbound_email_jobs")
      .select("provider_message_id")
      .like("provider_message_id", "resend:%")
      .in("status", ["PENDING", "PROCESSING", "COMPLETE"])
      .limit(1000),
  ]);
  if (listed.error || !listed.data) throw listed.error ?? new Error("Unable to list received Resend emails.");
  if (existing.error) throw existing.error;

  const alreadyQueued = new Set(existing.data.map((row) => row.provider_message_id));
  const candidates = listed.data.data
    .map((email) => ({
      email,
      recipient: findResendForwardingRecipient(email, inboundDomain),
    }))
    .filter((candidate): candidate is { email: ListReceivingEmail; recipient: string } => (
      Boolean(candidate.recipient) && !alreadyQueued.has(`resend:${candidate.email.id}`)
    ))
    .sort((left, right) => left.email.created_at.localeCompare(right.email.created_at));

  let queued = 0;
  for (const candidate of candidates) {
    try {
      if (await queueReceivedEmail(candidate.email, candidate.recipient, inboundDomain, client, resend)) queued += 1;
    } catch (error) {
      console.error(`Could not queue Resend email ${candidate.email.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return queued;
}
