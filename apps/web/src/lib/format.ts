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

export function titleCase(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

/** The label for a timeline event type. */
export function eventTypeLabel(value: string) {
  return titleCase(value).replace(/^Jd\b/, "JD");
}
