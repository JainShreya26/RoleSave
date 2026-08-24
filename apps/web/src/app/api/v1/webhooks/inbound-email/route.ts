import { timingSafeEqual } from "node:crypto";
import { inboundEmailEnvelopeSchema } from "@manager/validation";
import { getInboundEmailWebhookSecret } from "@/lib/email";
import {
  enqueueInboundEmail,
  InboundEmailQueueError,
  PayloadTooLargeError,
  readBodyWithLimit,
} from "@/lib/inbound-email";

export const runtime = "nodejs";

function hasValidAuthorization(request: Request, expectedSecret: string) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return false;

  const provided = Buffer.from(authorization.slice("Bearer ".length), "utf8");
  const expected = Buffer.from(expectedSecret, "utf8");
  return provided.byteLength === expected.byteLength && timingSafeEqual(provided, expected);
}

export async function POST(request: Request) {
  const webhookSecret = getInboundEmailWebhookSecret();
  if (!webhookSecret) {
    return Response.json({ error: "Inbound email is not configured." }, { status: 503 });
  }

  if (!hasValidAuthorization(request, webhookSecret)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const envelope = inboundEmailEnvelopeSchema.safeParse({
    providerMessageId: request.headers.get("x-provider-message-id"),
    recipient: request.headers.get("x-ledger-recipient"),
  });
  if (!envelope.success) {
    return Response.json(
      { error: "X-Ledger-Recipient and X-Provider-Message-Id headers are required." },
      { status: 400 },
    );
  }

  let rawEmail: Buffer;
  try {
    rawEmail = await readBodyWithLimit(request.body, request.headers.get("content-length"));
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return Response.json({ error: "Raw email exceeds the 10 MB limit." }, { status: 413 });
    }
    return Response.json({ error: "Unable to read the raw email." }, { status: 400 });
  }

  if (rawEmail.byteLength === 0) {
    return Response.json({ error: "A raw RFC 822 message is required." }, { status: 400 });
  }

  try {
    const result = await enqueueInboundEmail({
      providerMessageId: envelope.data.providerMessageId,
      rawEmail,
      recipient: envelope.data.recipient,
    });
    return Response.json({ ...result, status: "queued" }, { status: 202 });
  } catch (error) {
    if (error instanceof InboundEmailQueueError) {
      const status = error.code === "FORWARDING_ADDRESS_NOT_FOUND"
        ? 404
        : error.code === "CONFIGURATION"
          ? 503
          : 500;
      return Response.json({ error: error.message }, { status });
    }
    return Response.json({ error: "Unable to queue the raw email." }, { status: 500 });
  }
}
