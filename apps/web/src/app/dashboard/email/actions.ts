"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireViewer } from "@/lib/auth";
import { getInboundEmailDomain, isEmailSimulatorEnabled } from "@/lib/email";
import { enqueueInboundEmail } from "@/lib/inbound-email";
import { createAdminClient } from "@/lib/supabase/admin";

export interface EmailConnectionActionState {
  message?: string;
  success?: boolean;
}

const simulatorScenarios = ["APPLICATION_CONFIRMED", "ASSESSMENT_REQUESTED", "INTERVIEW_REQUESTED", "REJECTION_RECEIVED", "OFFER_RECEIVED"] as const;

function safeHeader(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim().slice(0, 300);
}

const emailAddressPattern = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export async function importEmailAction(
  _previousState: EmailConnectionActionState,
  formData: FormData,
): Promise<EmailConnectionActionState> {
  void _previousState;
  const senderAddressValue = formData.get("senderAddress");
  const senderNameValue = formData.get("senderName");
  const subjectValue = formData.get("subject");
  const bodyValue = formData.get("body");
  const senderAddress = typeof senderAddressValue === "string" ? senderAddressValue.trim().toLowerCase() : "";
  const senderName = typeof senderNameValue === "string" ? senderNameValue.trim() : "";
  const subject = typeof subjectValue === "string" ? subjectValue.trim() : "";
  const body = typeof bodyValue === "string" ? bodyValue.trim() : "";

  if (!emailAddressPattern.test(senderAddress)) return { message: "Enter the sender's email address." };
  if (subject.length < 1 || subject.length > 500) return { message: "Enter a subject of 500 characters or fewer." };
  if (senderName.length > 200) return { message: "The sender name must be 200 characters or fewer." };
  if (body.length < 1 || body.length > 100_000) return { message: "Paste between 1 and 100,000 characters of email text." };

  const { supabase, viewer } = await requireViewer();
  const { data: account, error: accountError } = await supabase
    .from("email_accounts")
    .select("email_address")
    .eq("user_id", viewer.id)
    .eq("provider", "FORWARDING")
    .maybeSingle();
  if (accountError || !account) return { message: "Create a RoleSave forwarding address before importing email." };

  const messageId = `${randomUUID()}@manual.rolesave.local`;
  const from = senderName ? `${safeHeader(senderName)} <${senderAddress}>` : senderAddress;
  const rawEmail = Buffer.from([
    `From: ${from}`,
    `To: ${safeHeader(account.email_address)}`,
    `Subject: ${safeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${messageId}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
    "",
  ].join("\r\n"));

  try {
    await enqueueInboundEmail({
      providerMessageId: `manual:${messageId}`,
      rawEmail,
      recipient: account.email_address,
    });
  } catch (error) {
    return { message: `Unable to import the email: ${error instanceof Error ? error.message : String(error)}` };
  }

  revalidatePath("/dashboard/email");
  revalidatePath("/dashboard/review");
  return { message: "Email queued. The local worker will classify and match it.", success: true };
}

function buildSimulatedEmail(application: { company: string; job_id: string | null; position: string }, scenario: typeof simulatorScenarios[number]) {
  const company = safeHeader(application.company);
  const position = safeHeader(application.position);
  const jobId = safeHeader(application.job_id ?? `SIM-${randomUUID().slice(0, 8).toUpperCase()}`);
  const templates = {
    APPLICATION_CONFIRMED: {
      body: `We received your application for ${position}.\nRequisition ID: ${jobId}`,
      subject: `Thank you for applying to ${company}`,
    },
    ASSESSMENT_REQUESTED: {
      body: `Please complete the technical assessment for the ${position} position.\nJob ID: ${jobId}`,
      subject: `Technical assessment for your ${company} application`,
    },
    INTERVIEW_REQUESTED: {
      body: `We would like to interview you for the ${position} position.\nSchedule your interview: https://calendly.com/rolesave-simulator/interview\nJob ID: ${jobId}`,
      subject: `Interview availability for ${position}`,
    },
    REJECTION_RECEIVED: {
      body: `We will not be moving forward with your application for the ${position} position.\nJob ID: ${jobId}`,
      subject: `Update on your ${company} application`,
    },
    OFFER_RECEIVED: {
      body: `We are pleased to offer you the ${position} position. Your offer letter will follow.\nJob ID: ${jobId}`,
      subject: `Your offer from ${company}`,
    },
  } satisfies Record<typeof simulatorScenarios[number], { body: string; subject: string }>;
  const template = templates[scenario];
  const messageId = `${randomUUID()}@simulator.rolesave.local`;

  return {
    messageId,
    raw: Buffer.from([
      `From: ${company} Recruiting <notifications@simulator.greenhouse.io>`,
      "To: RoleSave test recipient",
      `Subject: ${template.subject}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${messageId}>`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "",
      template.body,
      "",
    ].join("\r\n")),
  };
}

export async function issueForwardingAddressAction(
  _previousState: EmailConnectionActionState,
  _formData: FormData,
): Promise<EmailConnectionActionState> {
  void _previousState;
  void _formData;

  const domain = getInboundEmailDomain();
  if (!domain) {
    return { message: "Email forwarding is not configured on this deployment yet." };
  }

  const { supabase } = await requireViewer();
  const { error } = await supabase.rpc("issue_forwarding_address", { p_domain: domain });

  if (error) {
    return { message: `Unable to create a forwarding address: ${error.message}` };
  }

  revalidatePath("/dashboard/email");
  return { message: "Your private forwarding address is ready.", success: true };
}

export async function disconnectForwardingAddressAction(
  _previousState: EmailConnectionActionState,
  formData: FormData,
): Promise<EmailConnectionActionState> {
  void _previousState;
  const accountId = formData.get("accountId");

  if (typeof accountId !== "string" || !/^[0-9a-f-]{36}$/i.test(accountId)) {
    return { message: "The email connection could not be identified." };
  }

  const { supabase, viewer } = await requireViewer();
  const admin = createAdminClient();
  const { data: storedMessages, error: storedMessageError } = await admin
    .from("inbound_email_jobs")
    .select("id,storage_path")
    .eq("email_account_id", accountId)
    .eq("user_id", viewer.id)
    .is("storage_deleted_at", null);
  if (storedMessageError) {
    return { message: `Unable to inspect stored email data: ${storedMessageError.message}` };
  }

  if (storedMessages.length > 0) {
    const paths = storedMessages.map((message) => message.storage_path);
    const { error: storageError } = await admin.storage.from("inbound-emails").remove(paths);
    if (storageError) {
      return { message: `Unable to delete stored email data: ${storageError.message}` };
    }

    const { error: cleanupStateError } = await admin
      .from("inbound_email_jobs")
      .update({ storage_deleted_at: new Date().toISOString() })
      .in("id", storedMessages.map((message) => message.id))
      .eq("user_id", viewer.id);
    if (cleanupStateError) {
      return { message: `Stored email was deleted, but cleanup could not be recorded: ${cleanupStateError.message}` };
    }
  }

  const { error } = await supabase
    .from("email_accounts")
    .delete()
    .eq("id", accountId)
    .eq("user_id", viewer.id)
    .eq("provider", "FORWARDING");

  if (error) {
    return { message: `Unable to disconnect email forwarding: ${error.message}` };
  }

  revalidatePath("/dashboard/email");
  return { message: "Email forwarding disconnected.", success: true };
}

export async function simulateInboundEmailAction(
  _previousState: EmailConnectionActionState,
  formData: FormData,
): Promise<EmailConnectionActionState> {
  void _previousState;
  const applicationId = formData.get("applicationId");
  const scenarioValue = formData.get("scenario");
  const scenario = simulatorScenarios.find((item) => item === scenarioValue);

  if (!isEmailSimulatorEnabled()) return { message: "The local email simulator is not enabled." };
  if (typeof applicationId !== "string" || !/^[0-9a-f-]{36}$/i.test(applicationId) || !scenario) {
    return { message: "Choose an application and email scenario." };
  }

  const { supabase, viewer } = await requireViewer();
  const [{ data: application, error: applicationError }, { data: account, error: accountError }] = await Promise.all([
    supabase.from("applications").select("company,position,job_id").eq("id", applicationId).eq("user_id", viewer.id).maybeSingle(),
    supabase.from("email_accounts").select("email_address").eq("user_id", viewer.id).eq("provider", "FORWARDING").maybeSingle(),
  ]);
  if (applicationError || !application) return { message: "The selected application was not found." };
  if (accountError || !account) return { message: "Create a forwarding address before sending a test email." };

  const simulated = buildSimulatedEmail(application, scenario);
  try {
    await enqueueInboundEmail({
      providerMessageId: `simulator:${simulated.messageId}`,
      rawEmail: simulated.raw,
      recipient: account.email_address,
    });
  } catch (error) {
    return { message: `Unable to queue the test email: ${error instanceof Error ? error.message : String(error)}` };
  }

  revalidatePath("/dashboard/email");
  return {
    message: "Test email queued. Run `pnpm email:process-once`, then refresh Applications or Needs review.",
    success: true,
  };
}
