// Mirrors the application_status Postgres enum exactly, so rows read back from
// the database always satisfy this type.
export const applicationStatuses = [
  "SAVED", "APPLIED", "ASSESSMENT", "INTERVIEW", "OFFER", "REJECTED", "WITHDRAWN", "NEEDS_REVIEW",
] as const;
export type ApplicationStatus = (typeof applicationStatuses)[number];

// What a person may actually choose. NEEDS_REVIEW is a legacy enum member that
// nothing assigns: review of an uncertain email lives in review_tasks, never in
// the application's own status. It stays above only until the enum is rebuilt.
export const selectableApplicationStatuses = applicationStatuses
  .filter((status): status is Exclude<ApplicationStatus, "NEEDS_REVIEW"> => status !== "NEEDS_REVIEW");

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
