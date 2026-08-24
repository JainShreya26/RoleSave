# MHTML capture and PDF conversion spike

This Phase 0 spike tests the riskiest part of job-description preservation before it is integrated into the production API, worker, and private storage. For local development, the extension can now send a capture to a loopback-only converter and download the resulting PDF in one click.

## What is included

- A load-unpacked Manifest V3 extension that captures the active tab after an explicit click and downloads the converted PDF.
- A converter service bound to `127.0.0.1:4318` that accepts only Chrome-extension origins.
- A small metadata sidecar containing company, position, source URL, and capture time.
- A Playwright/Chromium converter that opens a local MHTML file and prints it to PDF.
- A deterministic static fixture and verification command.

The converter normalizes MIME line endings and refuses to create a PDF when Chrome loads fewer than 50 visible characters. This prevents a blank-but-technically-valid PDF from being treated as a successful conversion. Before printing, it also removes fixed/sticky page chrome, hidden tooltips, and inaccessible Material icon ligatures that otherwise overlap job content or render as words.

The extension requests `activeTab`, `pageCapture`, and access to `http://127.0.0.1:4318/*`. Captures do not leave the computer. The local service limits captures to 25 MB, validates metadata, and deletes request files after conversion. It does not contain production authentication or private storage yet.

## One-click local PDF flow

From the repository root, start the converter and leave this terminal open:

```sh
pnpm spike:mhtml:serve
```

Chrome setup:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. If the extension is already installed, select its **Reload** button so Chrome picks up version `0.2.0` and the localhost permission. Otherwise choose **Load unpacked** and select `spikes/mhtml-capture/extension`.
4. Open a job description and let lazy-loaded content finish rendering.
5. Open the extension, correct the suggested position, enter the company, and select **Save job description PDF**.
6. Keep the popup open while it says **Converting capture to PDF**. The PDF downloads through Chrome when conversion finishes.

If the service is unavailable or conversion fails, the extension downloads the raw `.mhtml` and `.json` files instead, so the capture is not lost.

## Verify the converter

From the repository root:

```sh
pnpm install
pnpm spike:mhtml:verify
```

The PDF is written to `spikes/mhtml-capture/output/static-job.pdf`.

## Manual capture fallback

1. Open `chrome://extensions` in Google Chrome.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select `spikes/mhtml-capture/extension`.
4. Open a job description and let lazy-loaded content finish rendering.
5. With the local service stopped, open the extension, correct the suggested position, enter the company, and select **Save job description PDF**. The failed service request triggers the raw-file fallback.
6. Move the downloaded `.mhtml` and `.json` files into `spikes/mhtml-capture/captures/`. This directory is ignored because captures may contain personal or authenticated data.
7. Convert the capture manually:

```sh
pnpm spike:mhtml:convert -- \
  --input spikes/mhtml-capture/captures/example.mhtml \
  --output spikes/mhtml-capture/output/example.pdf \
  --metadata spikes/mhtml-capture/captures/example.json
```

Values passed explicitly with `--company`, `--position`, `--original-url`, or `--captured-at` override their counterparts in the metadata sidecar.

Open the PDF and record the result in `RESULTS.md`. Check text, images, fonts, long sections, links, content that appeared after scrolling, and content visible only while signed in.

## Verify the HTTP flow

```sh
pnpm spike:mhtml:verify-server
```

This starts the service on an ephemeral local port, rejects an untrusted web origin, submits the static MHTML fixture from a simulated Chrome-extension origin, and validates the returned PDF.

## Test matrix

Run the manual capture against:

- A static company job page
- LinkedIn job details
- Workday
- Greenhouse
- Lever
- A page requiring authentication
- A page with lazy-loaded sections

Do not commit real captures. If a reproducible fixture is needed, remove names, email addresses, tokens, tracking parameters, and any other personal information first.
