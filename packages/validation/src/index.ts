import { z } from "zod";
import { applicationSources, applicationStatuses, captureStatuses, eventSources, eventTypes } from "@manager/types";

export const applicationStatusSchema = z.enum(applicationStatuses);
export const applicationSourceSchema = z.enum(applicationSources);
export const eventTypeSchema = z.enum(eventTypes);
export const eventSourceSchema = z.enum(eventSources);
export const captureStatusSchema = z.enum(captureStatuses);

export const authCredentialsSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

const httpUrlSchema = z.url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "http:" || protocol === "https:";
}, "URL must use HTTP or HTTPS");

export const createApplicationSchema = z.object({
  company: z.string().trim().min(1).max(200),
  position: z.string().trim().min(1).max(300),
  source: applicationSourceSchema.default("MANUAL"),
  originalUrl: httpUrlSchema.nullable().optional(),
  jobId: z.string().trim().max(200).nullable().optional(),
  appliedAt: z.iso.datetime({ offset: true }).nullable().optional(),
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

export const inboundEmailEnvelopeSchema = z.object({
  providerMessageId: z.string().trim().min(1).max(512),
  recipient: z.string().trim().toLowerCase().pipe(z.email()),
});

export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;
export type AuthCredentialsInput = z.infer<typeof authCredentialsSchema>;
export type CaptureMetadataInput = z.infer<typeof captureMetadataSchema>;
export type CaptureJobInput = z.infer<typeof captureJobSchema>;
export type CaptureQueueJobInput = z.infer<typeof captureQueueJobSchema>;
export type InboundEmailEnvelopeInput = z.infer<typeof inboundEmailEnvelopeSchema>;
