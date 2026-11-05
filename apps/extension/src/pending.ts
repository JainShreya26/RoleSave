export interface PendingApplication {
  applicationId: string;
  company: string;
  position: string;
  savedAt: string;
  url?: string;
  userId: string;
}

interface PageDetails {
  company: string;
  position: string;
  url: string;
}

export const pendingStorageKey = "rolesave.pendingApplication";
const lifetime = 7 * 24 * 60 * 60 * 1_000;
const maxPendingPerUser = 10;

/** Keeps valid, unexpired records from every account, newest first. */
export function parsePendingApplications(stored: unknown, now: number): PendingApplication[] {
  const records: unknown[] = Array.isArray(stored) ? stored : [];
  return records
    .filter((record): record is PendingApplication => {
      if (!record || typeof record !== "object") return false;
      const item = record as Partial<PendingApplication>;
      if (typeof item.applicationId !== "string" || typeof item.company !== "string") return false;
      if (typeof item.position !== "string" || typeof item.savedAt !== "string") return false;
      if (typeof item.userId !== "string") return false;
      const savedAt = new Date(item.savedAt).valueOf();
      return Number.isFinite(savedAt) && now - savedAt <= lifetime;
    })
    .sort((first, second) => second.savedAt.localeCompare(first.savedAt));
}

/** Adds an application to one account's list, keeping that list within its limit. */
export function addPendingApplication(all: PendingApplication[], item: PendingApplication) {
  const others = all.filter((existing) => existing.applicationId !== item.applicationId);
  const sameUser = others.filter((existing) => existing.userId === item.userId).slice(0, maxPendingPerUser - 1);
  const otherUsers = others.filter((existing) => existing.userId !== item.userId);
  return [item, ...sameUser, ...otherUsers];
}

function pageAddress(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname.replace(/\/+$/, "")}${parsed.search}`;
  } catch {
    return url;
  }
}

function sameText(first: string, second: string) {
  return first.trim() !== "" && first.trim().toLowerCase() === second.trim().toLowerCase();
}

/** Finds the in-progress application for this page, including its separate apply page. */
export function findPendingForPage(pending: PendingApplication[], page: PageDetails | null) {
  if (!page) return undefined;
  return pending.find(
    (item) =>
      (item.url !== undefined && pageAddress(item.url) === pageAddress(page.url)) ||
      (sameText(item.company, page.company) && sameText(item.position, page.position)),
  );
}

// The popup and the background can both change these lists, so each change
// holds a lock while it reads and writes.
function updateStoredPending(change: (all: PendingApplication[]) => PendingApplication[]) {
  return navigator.locks.request(pendingStorageKey, async () => {
    const stored = (await chrome.storage.local.get(pendingStorageKey))[pendingStorageKey] as unknown;
    const next = change(parsePendingApplications(stored, Date.now()));
    await chrome.storage.local.set({ [pendingStorageKey]: next });
    return next;
  });
}

export async function readPendingApplications(userId: string): Promise<PendingApplication[]> {
  const stored = (await chrome.storage.local.get(pendingStorageKey))[pendingStorageKey] as unknown;
  return parsePendingApplications(stored, Date.now()).filter((item) => item.userId === userId);
}

export async function rememberPendingApplication(item: PendingApplication) {
  await updateStoredPending((all) => addPendingApplication(all, item));
}

export async function clearPendingApplication(applicationId: string) {
  await updateStoredPending((all) => all.filter((item) => item.applicationId !== applicationId));
}
