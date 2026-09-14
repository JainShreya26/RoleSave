import "server-only";

const domainPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export function getInboundEmailDomain() {
  const domain = process.env.INBOUND_EMAIL_DOMAIN?.trim().toLowerCase();
  return domain && domainPattern.test(domain) ? domain : null;
}

export function getResendApiKey() {
  const key = process.env.RESEND_API_KEY?.trim();
  return key && key.length >= 16 ? key : null;
}

export function extractForwardingToken(recipient: string, expectedDomain: string) {
  const match = /^jobs\+([0-9a-f]{36})@(.+)$/.exec(recipient.trim().toLowerCase());
  if (!match || match[2] !== expectedDomain) return null;
  return match[1];
}

// The simulator queues a synthetic message straight into the inbound queue, so
// it needs no base URL and no shared secret: it never leaves this process.
export function isEmailSimulatorEnabled() {
  return process.env.NODE_ENV !== "production" && process.env.ENABLE_EMAIL_SIMULATOR === "true";
}
