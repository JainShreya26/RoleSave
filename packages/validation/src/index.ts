import { z } from "zod";
import { applicationSources, applicationStatuses } from "@rolesave/types";

export const applicationStatusSchema = z.enum(applicationStatuses);
// What a person may choose. NEEDS_REVIEW is a legacy value that nothing assigns.
export const selectableApplicationStatusSchema = applicationStatusSchema.exclude(["NEEDS_REVIEW"]);
export const triageDecisionSchema = z.enum(["PURSUE", "MAYBE", "PASS"]);
export const triageSchema = z.object({
  decision: triageDecisionSchema.nullable(),
  reason: z.string().trim().max(500).nullable(),
});
const applicationSourceSchema = z.enum(applicationSources);

const uuidShapedSchema = z.guid();

/** Whether a value has the shape of a UUID. The database raises an error for anything else. */
export function isUuid(value: unknown): value is string {
  return uuidShapedSchema.safeParse(value).success;
}

export const authCredentialsSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export const emailSchema = z.object({
  email: authCredentialsSchema.shape.email,
});

export const newPasswordSchema = z
  .object({
    password: authCredentialsSchema.shape.password,
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

/**
 * Returns a same-origin path that is safe to redirect to after sign-in, or the
 * fallback. Rejects absolute URLs, protocol-relative URLs, backslash tricks,
 * and control characters so `?next=` cannot become an open redirect.
 */
export function safeRedirectPath(value: unknown, fallback = "/dashboard"): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;
  if (value === "/auth" || value.startsWith("/auth/") || value.startsWith("/auth?")) return fallback;
  return value;
}

const httpUrlMessage = "Enter a full web address, starting with http:// or https://";
const httpUrlSchema = z.url({ error: httpUrlMessage, protocol: /^https?$/ });

/**
 * Like safeRedirectPath, but also accepts an absolute URL on the given origin.
 * Auth email links carry the return page as a full URL (`{{ .RedirectTo }}`).
 */
export function safeRedirectPathFromLink(value: unknown, origin: string, fallback = "/dashboard"): string {
  const path = typeof value === "string" && value.startsWith(`${origin}/`) ? value.slice(origin.length) : value;
  return safeRedirectPath(path, fallback);
}

// Allows for a browser clock that runs slightly ahead of the server's.
const clockTolerance = 5 * 60 * 1_000;
function notInTheFuture(value: string) {
  const time = Date.parse(value);
  return Number.isNaN(time) || time <= Date.now() + clockTolerance;
}

export const createApplicationSchema = z.object({
  company: z.string().trim().min(1, "Enter the company name").max(200, "Keep the company name to 200 characters or fewer"),
  position: z.string().trim().min(1, "Enter the position").max(300, "Keep the position to 300 characters or fewer"),
  source: applicationSourceSchema.default("MANUAL"),
  originalUrl: httpUrlSchema.nullable().optional(),
  jobId: z.string().trim().max(200, "Keep the job ID to 200 characters or fewer").nullable().optional(),
  appliedAt: z.iso.datetime({ error: "Enter a valid date and time", offset: true })
    .refine(notInTheFuture, "The applied date can't be in the future")
    .nullable()
    .optional(),
});

export const applicationActionSchema = z.object({
  title: z.string({ error: "Enter what needs doing" }).trim().min(1, "Enter what needs doing").max(200, "Keep the action to 200 characters or fewer"),
  dueAt: z.iso.datetime({ error: "Choose a due date", offset: true }),
  remindAt: z.iso.datetime({ error: "Choose a valid reminder time", offset: true }).nullable(),
}).refine((action) => !action.remindAt || action.remindAt <= action.dueAt, {
  message: "Reminder must be before the action is due",
  path: ["remindAt"],
});

export const captureMetadataSchema = z.object({
  company: z.string().trim().min(1).max(200),
  position: z.string().trim().min(1).max(300),
  originalUrl: httpUrlSchema,
  capturedAt: z.iso.datetime({ offset: true }),
});

export const captureJobSchema = captureMetadataSchema.extend({
  applicationId: z.uuid(),
  documentId: z.uuid(),
  userId: z.uuid(),
  temporaryStoragePath: z.string().min(1).max(1_024),
  outputStoragePath: z.string().min(1).max(1_024),
});

export const captureQueueJobSchema = captureJobSchema.extend({
  jobId: z.uuid(),
});

export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;
export type AuthCredentialsInput = z.infer<typeof authCredentialsSchema>;
export type CaptureJobInput = z.infer<typeof captureJobSchema>;
export type CaptureQueueJobInput = z.infer<typeof captureQueueJobSchema>;
