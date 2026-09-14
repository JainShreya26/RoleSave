import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const DEFAULT_CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function firstExistingPath(paths) {
  for (const candidate of paths) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try the next known browser path.
    }
  }
  return undefined;
}

export async function resolveChromePath(explicitPath) {
  const configuredPath = explicitPath || process.env.MHTML_CHROME_PATH;
  if (configuredPath) {
    await fs.access(configuredPath);
    return configuredPath;
  }

  const detected = await firstExistingPath(DEFAULT_CHROME_PATHS);
  if (!detected) {
    throw new Error(
      "Chrome/Chromium was not found. Pass --chrome-path /absolute/path/to/chrome.",
    );
  }
  return detected;
}

export async function convertMhtmlToPdf({
  input,
  output,
  chromePath,
  company = "",
  position = "",
  originalUrl = "",
  capturedAt = new Date().toISOString(),
}) {
  const inputPath = path.resolve(input);
  const outputPath = path.resolve(output);
  const executablePath = await resolveChromePath(chromePath);
  let temporaryDirectory;
  let browser;
  let context;

  await fs.access(inputPath);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  // Chrome's MHTML loader expects MIME-style CRLF line endings. Real captures
  // already use them, but normalizing here makes sanitized text fixtures and
  // captures that passed through text tooling deterministic as well.
  const source = await fs.readFile(inputPath, "utf8");
  const normalizedSource = source.replace(/\r?\n/g, "\r\n");
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rolesave-mhtml-"));
  const normalizedInputPath = path.join(temporaryDirectory, path.basename(inputPath));
  await fs.writeFile(normalizedInputPath, normalizedSource);

  try {
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: [
        "--disable-background-networking",
        ...(process.env.MHTML_CONTAINERIZED === "1" ? ["--no-sandbox"] : []),
      ],
    });
    context = await browser.newContext({
      javaScriptEnabled: false,
      serviceWorkers: "block",
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    await page.route("**/*", async (route) => {
      const protocol = new URL(route.request().url()).protocol;
      if (protocol === "file:" || protocol === "data:" || protocol === "blob:") {
        await route.continue();
        return;
      }
      await route.abort("blockedbyclient");
    });
    await page.goto(pathToFileURL(normalizedInputPath).href, {
      waitUntil: "load",
      timeout: 30_000,
    });
    await page.emulateMedia({ media: "screen" });

    const capturedText = (await page.locator("body").innerText()).trim();
    if (capturedText.length < 50) {
      throw new Error(
        `MHTML loaded without enough visible text (${capturedText.length} characters); PDF was not created.`,
      );
    }

    // Screen-oriented job pages often contain sticky navigation that repeats
    // over every printed page. Captured icon fonts can also be unavailable when
    // the local MHTML is reopened, exposing ligature names such as
    // "arrow_back". Mark only page chrome and aria-hidden icon text; preserve
    // the actual job content and ordinary in-flow controls.
    await page.evaluate(() => {
      for (const element of document.body.querySelectorAll("*")) {
        const position = window.getComputedStyle(element).position;
        if (position === "fixed" || position === "sticky") {
          element.setAttribute("data-rolesave-print-chrome", "true");
        }
      }
      const printCleanup = document.createElement("style");
      printCleanup.textContent = `
        [data-rolesave-print-chrome="true"],
        [role="tooltip"],
        .google-material-icons[aria-hidden="true"],
        .material-icons[aria-hidden="true"],
        .material-symbols-outlined[aria-hidden="true"] {
          display: none !important;
        }
      `;
      document.head.append(printCleanup);
    });

    const headerParts = [
      company && `<strong>${escapeHtml(company)}</strong>`,
      position && escapeHtml(position),
      `Captured ${escapeHtml(capturedAt)}`,
      originalUrl && escapeHtml(originalUrl),
    ].filter(Boolean);

    await page.pdf({
      path: outputPath,
      format: "Letter",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: `<div style="box-sizing:border-box;width:100%;padding:0 0.45in;font-family:Arial,sans-serif;font-size:8px;color:#444;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${headerParts.join(
        " &nbsp;·&nbsp; ",
      )}</div>`,
      footerTemplate:
        '<div style="box-sizing:border-box;width:100%;padding:0 0.45in;text-align:right;font-family:Arial,sans-serif;font-size:8px;color:#777"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      margin: { top: "0.55in", right: "0.45in", bottom: "0.5in", left: "0.45in" },
    });
  } finally {
    if (context) {
      await context.close();
    }
    if (browser) {
      await browser.close();
    }
    if (temporaryDirectory) {
      await fs.rm(temporaryDirectory, { recursive: true, force: true });
    }
  }

  return outputPath;
}

function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") {
      continue;
    }
    if (!argument.startsWith("--")) {
      throw new Error(`Unexpected argument: ${argument}`);
    }
    const key = argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${argument}`);
    }
    options[key] = value;
    index += 1;
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.metadata) {
    const metadataPath = path.resolve(options.metadata);
    const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
    options.company ||= metadata.company;
    options.position ||= metadata.position;
    options.originalUrl ||= metadata.originalUrl;
    options.capturedAt ||= metadata.capturedAt;
  }
  if (!options.input || !options.output) {
    console.error(
      "Usage: pnpm convert -- --input capture.mhtml --output capture.pdf [--metadata capture.json] [--company Acme] [--position Engineer] [--original-url https://example.com] [--captured-at ISO_DATE] [--chrome-path PATH]",
    );
    process.exitCode = 1;
    return;
  }

  const outputPath = await convertMhtmlToPdf(options);
  console.log(`Created ${outputPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
