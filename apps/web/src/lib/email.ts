import "server-only";

const domainPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export function getInboundEmailDomain() {
  const domain = process.env.INBOUND_EMAIL_DOMAIN?.trim().toLowerCase();
  return domain && domainPattern.test(domain) ? domain : null;
}

export function getInboundEmailWebhookSecret() {
  const secret = process.env.INBOUND_EMAIL_WEBHOOK_SECRET?.trim();
  return secret && secret.length >= 32 ? secret : null;
}

export function getResendApiKey() {
  const key = process.env.RESEND_API_KEY?.trim();
  return key && key.length >= 16 ? key : null;
}

export function getResendWebhookSecret() {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  return secret && secret.length >= 16 ? secret : null;
}

export function extractForwardingToken(recipient: string, expectedDomain: string) {
  const match = /^jobs\+([0-9a-f]{36})@(.+)$/.exec(recipient.trim().toLowerCase());
  if (!match || match[2] !== expectedDomain) return null;
  return match[1];
}

export function getEmailSimulatorBaseUrl() {
  if (process.env.NODE_ENV === "production" || process.env.ENABLE_EMAIL_SIMULATOR !== "true") {
    return null;
  }

  const configured = process.env.EMAIL_SIMULATOR_BASE_URL?.trim() || "http://127.0.0.1:3000";
  try {
    const url = new URL(configured);
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(url.hostname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}
