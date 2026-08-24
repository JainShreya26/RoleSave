"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireViewer } from "@/lib/auth";
import { getEmailSimulatorBaseUrl, getInboundEmailDomain, getInboundEmailWebhookSecret } from "@/lib/email";

export interface EmailConnectionActionState {
  message?: string;
  success?: boolean;
}

const simulatorScenarios = ["APPLICATION_CONFIRMED", "ASSESSMENT_REQUESTED", "INTERVIEW_REQUESTED", "REJECTION_RECEIVED", "OFFER_RECEIVED"] as const;

function safeHeader(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim().slice(0, 300);
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
      body: `We would like to interview you for the ${position} position.\nSchedule your interview: https://calendly.com/ledger-simulator/interview\nJob ID: ${jobId}`,
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
  const messageId = `${randomUUID()}@simulator.ledger.local`;

  return {
    messageId,
    raw: Buffer.from([
      `From: ${company} Recruiting <notifications@simulator.greenhouse.io>`,
      "To: Ledger test recipient",
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
  const baseUrl = getEmailSimulatorBaseUrl();
  const webhookSecret = getInboundEmailWebhookSecret();
  const applicationId = formData.get("applicationId");
  const scenarioValue = formData.get("scenario");
  const scenario = simulatorScenarios.find((item) => item === scenarioValue);

  if (!baseUrl || !webhookSecret) return { message: "The local email simulator is not enabled." };
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
    const response = await fetch(`${baseUrl}/api/v1/webhooks/inbound-email`, {
      body: simulated.raw,
      headers: {
        Authorization: `Bearer ${webhookSecret}`,
        "Content-Type": "message/rfc822",
        "X-Ledger-Recipient": account.email_address,
        "X-Provider-Message-Id": simulated.messageId,
      },
      method: "POST",
    });
    const result = await response.json() as { error?: string; jobId?: string };
    if (!response.ok) return { message: result.error ?? `The webhook returned HTTP ${response.status}.` };
  } catch (error) {
    return { message: `Unable to reach the local webhook: ${error instanceof Error ? error.message : String(error)}` };
  }

  revalidatePath("/dashboard/email");
  return {
    message: "Test email queued. Run `pnpm email:process-once`, then refresh Applications or Needs review.",
    success: true,
  };
}
