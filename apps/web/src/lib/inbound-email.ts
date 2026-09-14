import "server-only";

import { extractForwardingToken, getInboundEmailDomain } from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/admin";

export const maximumRawEmailBytes = 10 * 1024 * 1024;

export class PayloadTooLargeError extends Error {}

export class InboundEmailQueueError extends Error {
  constructor(
    message: string,
    public readonly code: "CONFIGURATION" | "FORWARDING_ADDRESS_NOT_FOUND" | "PREPARE" | "STORAGE" | "FINALIZE",
  ) {
    super(message);
  }
}

export async function enqueueInboundEmail(input: {
  providerMessageId: string;
  rawEmail: Buffer;
  recipient: string;
}) {
  const inboundDomain = getInboundEmailDomain();
  if (!inboundDomain) {
    throw new InboundEmailQueueError("Inbound email is not configured.", "CONFIGURATION");
  }

  const forwardingToken = extractForwardingToken(input.recipient, inboundDomain);
  if (!forwardingToken) {
    throw new InboundEmailQueueError("Forwarding address not found.", "FORWARDING_ADDRESS_NOT_FOUND");
  }
  if (input.rawEmail.byteLength < 1 || input.rawEmail.byteLength > maximumRawEmailBytes) {
    throw new PayloadTooLargeError();
  }

  const supabase = createAdminClient();
  const prepared = await supabase.rpc("prepare_inbound_email_job", {
    p_forwarding_token: forwardingToken,
    p_provider_message_id: input.providerMessageId,
  });
  const job = prepared.data?.[0];

  if (prepared.error || !job) {
    const notFound = prepared.error?.message.includes("Forwarding address not found");
    throw new InboundEmailQueueError(
      notFound ? "Forwarding address not found." : "Unable to prepare the email job.",
      notFound ? "FORWARDING_ADDRESS_NOT_FOUND" : "PREPARE",
    );
  }

  if (job.already_queued) return { duplicate: true, jobId: job.job_id };

  const upload = await supabase.storage.from("inbound-emails").upload(job.storage_path, input.rawEmail, {
    contentType: "message/rfc822",
    upsert: true,
  });
  if (upload.error) {
    await supabase.rpc("fail_inbound_email_upload", {
      p_error: upload.error.message,
      p_job_id: job.job_id,
    });
    throw new InboundEmailQueueError("Unable to store the raw email.", "STORAGE");
  }

  const finalized = await supabase.rpc("finalize_inbound_email_upload", {
    p_file_size_bytes: input.rawEmail.byteLength,
    p_job_id: job.job_id,
  });
  if (finalized.error || !finalized.data) {
    await supabase.rpc("fail_inbound_email_upload", {
      p_error: finalized.error?.message ?? "Unable to finalize the inbound email upload.",
      p_job_id: job.job_id,
    });
    throw new InboundEmailQueueError("Unable to queue the raw email.", "FINALIZE");
  }

  return { duplicate: false, jobId: job.job_id };
}
