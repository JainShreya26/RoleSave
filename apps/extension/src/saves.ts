import type { CaptureRequest } from "./capture.ts";
import type { PendingApplication } from "./pending.ts";

/** A save that is running, or that failed and can be retried. Finished saves are removed. */
export interface SaveAttempt {
  company: string;
  error?: string;
  idempotencyKey: string;
  position: string;
  startedAt: string;
  status: "saving" | "failed";
  url: string;
  userId: string;
}

export interface SaveRequest extends CaptureRequest {
  idempotencyKey: string;
  type: "rolesave.save-job";
}

export type SaveResponse =
  | { item: PendingApplication; ok: true; reused: boolean }
  | { error: string; ok: false };

export const saveAttemptsStorageKey = "rolesave.saveAttempts";
const lifetime = 7 * 24 * 60 * 60 * 1_000;
// Chrome stops background work after five minutes, so a save still marked as
// running after that has died.
const runningLimit = 6 * 60 * 1_000;

export const connectionMessage = "RoleSave couldn't connect. Check your internet connection and try again.";
// The temporary-captures bucket's limit. The application is created before the
// upload starts, so the job is on the dashboard even though this upload failed.
const tooLargeMessage = "This page is over the 25 MB limit, so RoleSave couldn't save a PDF of it. The job is still on your dashboard.";

function errorText(error: unknown) {
  const message = (error as { message?: unknown } | null | undefined)?.message;
  return typeof message === "string" ? message : "";
}

export function isConnectionError(error: unknown) {
  return /failed to fetch|networkerror|load failed/i.test(errorText(error));
}

/** Turns a failure into a message that says what happened and what to do next. */
export function describeError(error: unknown, fallback: string) {
  if (isConnectionError(error)) return connectionMessage;
  if (/maximum allowed size/i.test(errorText(error))) return tooLargeMessage;
  return error instanceof Error ? error.message : fallback;
}

export function isSaveRequest(message: unknown): message is SaveRequest {
  return Boolean(message) && typeof message === "object" && (message as SaveRequest).type === "rolesave.save-job";
}

/** Keeps valid, unexpired attempts from every account, and fails any that died while running. */
export function parseSaveAttempts(stored: unknown, now: number): SaveAttempt[] {
  const records: unknown[] = Array.isArray(stored) ? stored : [];
  return records
    .filter((record): record is SaveAttempt => {
      if (!record || typeof record !== "object") return false;
      const item = record as Partial<SaveAttempt>;
      if (item.status !== "saving" && item.status !== "failed") return false;
      if (typeof item.idempotencyKey !== "string" || typeof item.url !== "string") return false;
      if (typeof item.company !== "string" || typeof item.position !== "string") return false;
      if (typeof item.userId !== "string" || typeof item.startedAt !== "string") return false;
      const startedAt = new Date(item.startedAt).valueOf();
      return Number.isFinite(startedAt) && now - startedAt <= lifetime;
    })
    .map((item) =>
      item.status === "saving" && now - new Date(item.startedAt).valueOf() > runningLimit
        ? { ...item, status: "failed" as const, error: "The save did not finish. Try again." }
        : item,
    );
}

function updateStoredAttempts(change: (all: SaveAttempt[]) => SaveAttempt[]) {
  return navigator.locks.request(saveAttemptsStorageKey, async () => {
    const stored = (await chrome.storage.local.get(saveAttemptsStorageKey))[saveAttemptsStorageKey] as unknown;
    await chrome.storage.local.set({ [saveAttemptsStorageKey]: change(parseSaveAttempts(stored, Date.now())) });
  });
}

export async function readSaveAttempts(userId: string): Promise<SaveAttempt[]> {
  const stored = (await chrome.storage.local.get(saveAttemptsStorageKey))[saveAttemptsStorageKey] as unknown;
  return parseSaveAttempts(stored, Date.now()).filter((item) => item.userId === userId);
}

export async function recordSaveAttempt(attempt: SaveAttempt) {
  await updateStoredAttempts((all) => [
    attempt,
    ...all.filter((item) => item.idempotencyKey !== attempt.idempotencyKey),
  ]);
}

export async function removeSaveAttempt(idempotencyKey: string) {
  await updateStoredAttempts((all) => all.filter((item) => item.idempotencyKey !== idempotencyKey));
}

export function requestSave(request: SaveRequest): Promise<SaveResponse> {
  return chrome.runtime.sendMessage(request);
}
