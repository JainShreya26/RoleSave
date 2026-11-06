import "server-only";

import { headers } from "next/headers";

/**
 * The public origin of the web app. Prefers NEXT_PUBLIC_SITE_URL, then the
 * forwarded or Host header, so redirects and email links stay on the host the
 * user actually visited (not an internal hostname behind a proxy).
 */
export async function siteOrigin() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol =
    requestHeaders.get("x-forwarded-proto") ?? (host?.startsWith("localhost") || host?.startsWith("127.") ? "http" : "https");
  return `${protocol}://${host}`;
}
