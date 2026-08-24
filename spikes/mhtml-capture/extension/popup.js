const companyInput = document.querySelector("#company");
const positionInput = document.querySelector("#position");
const pageTitle = document.querySelector("#page-title");
const pageUrl = document.querySelector("#page-url");
const captureButton = document.querySelector("#capture");
const status = document.querySelector("#status");
const CONVERTER_ORIGIN = "http://127.0.0.1:4318";

let activeTab;

function safeFilename(value) {
  return value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 80);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function encodeMetadata(metadata) {
  const bytes = new TextEncoder().encode(JSON.stringify(metadata));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function downloadRawCapture(capture, metadata, stem) {
  downloadBlob(capture, `${stem}.mhtml`);
  downloadBlob(
    new Blob([JSON.stringify(metadata, null, 2)], { type: "application/json" }),
    `${stem}.json`,
  );
}

async function convertCapture(capture, metadata) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 45_000);

  try {
    const response = await fetch(`${CONVERTER_ORIGIN}/v1/convert`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Manager-Metadata": encodeMetadata(metadata),
      },
      body: capture,
      signal: controller.signal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || `Converter returned HTTP ${response.status}.`);
    }

    return response.blob();
  } finally {
    window.clearTimeout(timeout);
  }
}

async function loadActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) {
    throw new Error("No capturable active tab was found.");
  }

  activeTab = tab;
  pageTitle.textContent = tab.title || "Untitled page";
  pageUrl.textContent = tab.url;
  pageUrl.title = tab.url;
  positionInput.value = tab.title || "";
}

captureButton.addEventListener("click", async () => {
  captureButton.disabled = true;
  status.dataset.kind = "info";
  status.textContent = "Capturing this tab…";

  try {
    if (!activeTab?.id) {
      await loadActiveTab();
    }

    const capture = await chrome.pageCapture.saveAsMHTML({ tabId: activeTab.id });
    if (!capture) {
      throw new Error("Chrome returned an empty capture.");
    }

    const capturedAt = new Date().toISOString();
    const stem =
      safeFilename(`${companyInput.value}-${positionInput.value}`) ||
      `job-page-${Date.now()}`;
    const metadata = {
      company: companyInput.value.trim(),
      position: positionInput.value.trim(),
      pageTitle: activeTab.title || "",
      originalUrl: activeTab.url,
      capturedAt,
    };

    status.textContent = "Converting capture to PDF…";
    try {
      const pdf = await convertCapture(capture, metadata);
      downloadBlob(pdf, `${stem}.pdf`);
      status.dataset.kind = "success";
      status.textContent = `Downloaded ${Math.ceil(pdf.size / 1024)} KB PDF.`;
    } catch (conversionError) {
      downloadRawCapture(capture, metadata, stem);
      status.dataset.kind = "error";
      const message =
        conversionError instanceof Error ? conversionError.message : String(conversionError);
      status.textContent = `PDF conversion failed (${message}). Raw capture and metadata were saved.`;
    }
  } catch (error) {
    status.dataset.kind = "error";
    status.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    captureButton.disabled = false;
  }
});

loadActiveTab().catch((error) => {
  status.dataset.kind = "error";
  status.textContent = error instanceof Error ? error.message : String(error);
  captureButton.disabled = true;
});
