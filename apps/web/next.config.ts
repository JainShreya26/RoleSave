import type { NextConfig } from "next";

const isDevelopment = process.env.NODE_ENV === "development";
// Local Supabase is not on supabase.co, so allow it in development only.
const localSupabaseOrigin = isDevelopment && process.env.NEXT_PUBLIC_SUPABASE_URL
  ? ` ${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin}`
  : "";
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  `connect-src 'self' https://*.supabase.co${localSupabaseOrigin}`,
  "font-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data: blob:",
  "object-src 'none'",
  `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
  // This also makes browsers send "Origin: null" when a form posts natively, and
  // Next.js refuses that. The root layout stops forms posting that way.
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
    : []),
];

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  headers() {
    return [{ headers: securityHeaders, source: "/:path*" }];
  },
  poweredByHeader: false,
  transpilePackages: ["@rolesave/types", "@rolesave/validation"],
};

export default nextConfig;
