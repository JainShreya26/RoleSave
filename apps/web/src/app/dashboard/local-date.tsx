"use client";

import { useSyncExternalStore } from "react";
import { dateFormat, dateLocale, dateTimeFormat, formatDate, formatDateTime } from "@/lib/format";

export const subscribeToNothing = () => () => {};

/**
 * The viewer's time zone. The server cannot know it, so the first render uses
 * UTC, and the browser corrects it as soon as the page loads.
 */
export function useViewerTimeZone() {
  return useSyncExternalStore(
    subscribeToNothing,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => "UTC",
  );
}

export function LocalDate({ fallback, value, withTime = false }: {
  fallback?: string;
  value: string | null;
  withTime?: boolean;
}) {
  const timeZone = useViewerTimeZone();
  const text = (withTime ? formatDateTime : formatDate)(value, fallback, timeZone);
  if (!value) return text;
  // LocalDatesScript may already have corrected this text, which is what the warning would flag.
  return <time data-local-date={withTime ? "time" : "date"} dateTime={value} suppressHydrationWarning>{text}</time>;
}

const correctDates = `document.querySelectorAll("time[data-local-date]").forEach(function(node){
  var format = node.getAttribute("data-local-date") === "time" ? ${JSON.stringify(dateTimeFormat)} : ${JSON.stringify(dateFormat)};
  node.textContent = new Intl.DateTimeFormat(${JSON.stringify(dateLocale)}, format).format(new Date(node.getAttribute("datetime")));
})`;

/**
 * Corrects every LocalDate on a full page load, before the browser paints, so
 * nobody sees a UTC date first. Render it once, after the page content. Browsers
 * do not run scripts added during client-side navigation, which is why it is
 * marked as plain text there: LocalDate already renders correctly in that case.
 */
export function LocalDatesScript() {
  return (
    <script
      dangerouslySetInnerHTML={{ __html: correctDates }}
      suppressHydrationWarning
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
    />
  );
}
