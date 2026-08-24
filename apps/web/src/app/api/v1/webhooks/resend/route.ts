import { Resend } from "resend";
import { extractForwardingToken, getInboundEmailDomain, getResendApiKey, getResendWebhookSecret } from "@/lib/email";
import {
  enqueueInboundEmail,
  InboundEmailQueueError,
  PayloadTooLargeError,
  readBodyWithLimit,
} from "@/lib/inbound-email";

export const runtime = "nodejs";

const maximumWebhookBytes = 256 * 1024;

function matchingRecipient(recipients: string[], domain: string) {
  return recipients.find((recipient) => extractForwardingToken(recipient, domain));
}

function safeHeader(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function fallbackRawEmail(email: {
  created_at: string;
  from: string;
  html: string | null;
  message_id: string;
  subject: string;
  text: string | null;
  to: string[];
}) {
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

async function downloadRawEmail(downloadUrl: string) {
  const url = new URL(downloadUrl);
  const resendHost = ["resend.com", "resend.app"].some((domain) => (
    url.hostname === domain || url.hostname.endsWith(`.${domain}`)
  ));
  if (url.protocol !== "https:" || !resendHost) {
    throw new Error("Resend returned an unexpected raw email URL.");
  }

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Unable to download the raw email (HTTP ${response.status}).`);
  return readBodyWithLimit(response.body, response.headers.get("content-length"));
}

export async function POST(request: Request) {
  const apiKey = getResendApiKey();
  const webhookSecret = getResendWebhookSecret();
  const inboundDomain = getInboundEmailDomain();
  if (!apiKey || !webhookSecret || !inboundDomain) {
    return Response.json({ error: "Resend inbound email is not configured." }, { status: 503 });
  }

  let payload: string;
  try {
    payload = (await readBodyWithLimit(
      request.body,
      request.headers.get("content-length"),
      maximumWebhookBytes,
    )).toString("utf8");
  } catch (error) {
    const status = error instanceof PayloadTooLargeError ? 413 : 400;
    return Response.json({ error: "Invalid Resend webhook payload." }, { status });
  }

  const resend = new Resend(apiKey);
  const webhookId = request.headers.get("svix-id");
  const webhookTimestamp = request.headers.get("svix-timestamp");
  const webhookSignature = request.headers.get("svix-signature");
  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    return Response.json({ error: "Missing Resend webhook signature headers." }, { status: 400 });
  }

  let event;
  try {
    event = resend.webhooks.verify({
      headers: { id: webhookId, signature: webhookSignature, timestamp: webhookTimestamp },
      payload,
      webhookSecret,
    });
  } catch {
    return Response.json({ error: "Invalid Resend webhook signature." }, { status: 401 });
  }

  if (event.type !== "email.received") {
    return Response.json({ ignored: true }, { status: 200 });
  }

  const received = await resend.emails.receiving.get(event.data.email_id, { html_format: "cid" });
  if (received.error || !received.data) {
    return Response.json({ error: "Unable to retrieve the received email from Resend." }, { status: 502 });
  }

  const recipient = matchingRecipient(
    [...new Set([
      ...(event.data.to ?? []),
      ...(event.data.received_for ?? []),
      ...(received.data.to ?? []),
      ...(received.data.received_for ?? []),
    ])],
    inboundDomain,
  );
  if (!recipient) {
    return Response.json({ ignored: true, reason: "No Ledger forwarding recipient." }, { status: 200 });
  }

  let rawEmail: Buffer;
  try {
    rawEmail = received.data.raw?.download_url
      ? await downloadRawEmail(received.data.raw.download_url)
      : fallbackRawEmail(received.data);
  } catch (error) {
    const tooLarge = error instanceof PayloadTooLargeError;
    return Response.json(
      { error: tooLarge ? "Raw email exceeds the 10 MB limit." : "Unable to retrieve the raw email." },
      { status: tooLarge ? 413 : 502 },
    );
  }

  try {
    const result = await enqueueInboundEmail({
      providerMessageId: `resend:${event.data.email_id}`,
      rawEmail,
      recipient,
    });
    return Response.json({ ...result, status: "queued" }, { status: 200 });
  } catch (error) {
    if (error instanceof InboundEmailQueueError && error.code === "FORWARDING_ADDRESS_NOT_FOUND") {
      return Response.json({ ignored: true, reason: error.message }, { status: 200 });
    }
    if (error instanceof PayloadTooLargeError) {
      return Response.json({ error: "Raw email exceeds the 10 MB limit." }, { status: 413 });
    }
    return Response.json({ error: "Unable to queue the received email." }, { status: 500 });
  }
}
