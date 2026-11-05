// Mirrors the application_status Postgres enum exactly, so rows read back from
// the database always satisfy this type.
export const applicationStatuses = [
  "SAVED", "APPLIED", "ASSESSMENT", "INTERVIEW", "OFFER", "REJECTED", "WITHDRAWN", "NEEDS_REVIEW",
] as const;
export type ApplicationStatus = (typeof applicationStatuses)[number];

// What a person may actually choose. NEEDS_REVIEW is a legacy enum member that
// nothing assigns. It stays above only until the enum is rebuilt.
export const selectableApplicationStatuses = applicationStatuses
  .filter((status): status is Exclude<ApplicationStatus, "NEEDS_REVIEW"> => status !== "NEEDS_REVIEW");

export const applicationSources = ["EXTENSION", "MANUAL"] as const;
export type ApplicationSource = (typeof applicationSources)[number];

export const eventTypes = [
  "JD_SAVED", "MARKED_AS_APPLIED", "APPLICATION_WITHDRAWN", "GENERAL_UPDATE", "MANUAL_CORRECTION",
] as const;
export type EventType = (typeof eventTypes)[number];

export const eventSources = ["EXTENSION", "MANUAL", "SYSTEM"] as const;
export type EventSource = (typeof eventSources)[number];

export const captureStatuses = ["PENDING", "PROCESSING", "COMPLETE", "FAILED"] as const;
export type CaptureStatus = (typeof captureStatuses)[number];
