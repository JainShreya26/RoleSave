export const applicationStatuses = [
  "SAVED", "APPLIED", "ASSESSMENT", "INTERVIEW", "OFFER", "REJECTED", "WITHDRAWN", "NEEDS_REVIEW",
] as const;
export type ApplicationStatus = (typeof applicationStatuses)[number];

export const applicationSources = ["EXTENSION", "EMAIL", "MANUAL"] as const;
export type ApplicationSource = (typeof applicationSources)[number];

export const eventTypes = [
  "JD_SAVED", "MARKED_AS_APPLIED", "APPLICATION_CONFIRMED", "ASSESSMENT_REQUESTED",
  "INTERVIEW_REQUESTED", "INTERVIEW_SCHEDULED", "INTERVIEW_RESCHEDULED", "OFFER_RECEIVED",
  "REJECTION_RECEIVED", "APPLICATION_WITHDRAWN", "GENERAL_UPDATE", "MANUAL_CORRECTION", "UNKNOWN_EMAIL_EVENT",
] as const;
export type EventType = (typeof eventTypes)[number];

export const eventSources = ["EXTENSION", "EMAIL", "MANUAL", "SYSTEM"] as const;
export type EventSource = (typeof eventSources)[number];

export const captureStatuses = ["PENDING", "PROCESSING", "COMPLETE", "FAILED"] as const;
export type CaptureStatus = (typeof captureStatuses)[number];

export interface ApplicationSummary {
  id: string;
  company: string;
  position: string;
  status: ApplicationStatus;
  source: ApplicationSource;
  originalUrl: string | null;
  appliedAt: string | null;
  createdAt: string;
  updatedAt: string;
  jobDescriptionStatus: CaptureStatus | null;
}

export interface CaptureJob {
  applicationId: string;
  documentId: string;
  userId: string;
  temporaryStoragePath: string;
  outputStoragePath: string;
  company: string;
  position: string;
  originalUrl: string;
  capturedAt: string;
}
