import { captureJob, saveTabAsMhtml } from "./capture.ts";
import { rememberPendingApplication } from "./pending.ts";
import { describeError, isSaveRequest, recordSaveAttempt, removeSaveAttempt, type SaveRequest, type SaveResponse } from "./saves.ts";
import { supabase } from "./supabase.ts";

// A popup closes as soon as the user clicks away, so saving runs here, where it
// can finish on its own.

// Chrome stops an idle background script after 30 seconds, and any extension
// API call counts as activity. A slow upload must not look idle.
function keepAliveWhileSaving() {
  const timer = setInterval(() => void chrome.runtime.getPlatformInfo(), 20_000);
  return () => clearInterval(timer);
}

async function saveJob(request: SaveRequest): Promise<SaveResponse> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) return { error: "Sign in again to save this job.", ok: false };

  const attempt = {
    company: request.company,
    idempotencyKey: request.idempotencyKey,
    position: request.position,
    startedAt: new Date().toISOString(),
    url: request.url,
    userId,
  };
  await recordSaveAttempt({ ...attempt, status: "saving" });
  const stopKeepingAlive = keepAliveWhileSaving();

  try {
    const result = await captureJob(request, request.idempotencyKey, { client: supabase, saveAsMhtml: saveTabAsMhtml });
    const item = {
      applicationId: result.applicationId,
      company: result.company,
      position: result.position,
      savedAt: new Date().toISOString(),
      url: request.url,
      userId,
    };
    await rememberPendingApplication(item);
    await removeSaveAttempt(request.idempotencyKey);
    return { item, ok: true, reused: result.reused };
  } catch (error) {
    const message = describeError(error, "The job could not be saved.");
    await recordSaveAttempt({ ...attempt, error: message, status: "failed" });
    // The popup may be long gone, so leave a sign on the toolbar icon.
    await chrome.action.setBadgeText({ text: "!" });
    await chrome.action.setBadgeBackgroundColor({ color: "#a13f3f" });
    return { error: message, ok: false };
  } finally {
    stopKeepingAlive();
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !isSaveRequest(message)) return undefined;
  void saveJob(message).then(respond);
  // Keeps the message open until the response is sent.
  return true;
});
