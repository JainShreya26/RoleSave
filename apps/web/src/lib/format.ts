export const dateLocale = "en-US";
export const dateFormat: Intl.DateTimeFormatOptions = { dateStyle: "medium" };
export const dateTimeFormat: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" };

// Without a time zone, these use the computer they run on. On a server that is
// not the viewer's, so anything shown on a page should go through LocalDate.
export function formatDateTime(value: string | null, fallback = "Not recorded", timeZone?: string) {
  if (!value) return fallback;
  return new Intl.DateTimeFormat(dateLocale, { ...dateTimeFormat, timeZone }).format(new Date(value));
}

export function formatDate(value: string | null, fallback = "Not recorded", timeZone?: string) {
  if (!value) return fallback;
  return new Intl.DateTimeFormat(dateLocale, { ...dateFormat, timeZone }).format(new Date(value));
}

/** The text a `datetime-local` input needs for a stored time, in this computer's time zone. */
export function toDateTimeLocal(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.valueOf() - offset).toISOString().slice(0, 16);
}

/** The stored time for what a `datetime-local` input holds, read in this computer's time zone. */
export function fromDateTimeLocal(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "" : date.toISOString();
}

const relativeTime = new Intl.RelativeTimeFormat(dateLocale);

/** How long ago something happened. It counts elapsed time, so it needs no time zone. */
export function timeAgo(value: string, now: number) {
  const minutes = Math.floor((now - Date.parse(value)) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return relativeTime.format(-minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return relativeTime.format(-hours, "hour");
  const days = Math.floor(hours / 24);
  if (days < 14) return relativeTime.format(-days, "day");
  if (days < 60) return relativeTime.format(-Math.floor(days / 7), "week");
  if (days < 730) return relativeTime.format(-Math.floor(days / 30), "month");
  return relativeTime.format(-Math.floor(days / 365), "year");
}

export function titleCase(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

const eventTypeLabels: Record<string, string> = {
  APPLICATION_CONFIRMED: "Application confirmed",
  APPLICATION_WITHDRAWN: "Withdrawn",
  ASSESSMENT_REQUESTED: "Assessment requested",
  GENERAL_UPDATE: "Update",
  INTERVIEW_REQUESTED: "Interview requested",
  INTERVIEW_RESCHEDULED: "Interview rescheduled",
  INTERVIEW_SCHEDULED: "Interview scheduled",
  JD_SAVED: "Job description saved",
  MANUAL_CORRECTION: "Status changed",
  MARKED_AS_APPLIED: "Marked as applied",
  OFFER_RECEIVED: "Offer received",
  REJECTION_RECEIVED: "Rejected",
  UNKNOWN_EMAIL_EVENT: "Email update",
};

/** The heading for a timeline event type. */
export function eventTypeLabel(value: string) {
  const label = eventTypeLabels[value];
  if (label) return label;
  const words = value.toLowerCase().replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
