import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { convertMhtmlToPdf } from "./convert.mjs";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4318;
const MAX_CAPTURE_BYTES = 25 * 1024 * 1024;
const EXTENSION_ORIGIN_PATTERN = /^chrome-extension:\/\/[a-p]{32}$/;

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function isAllowedExtensionOrigin(origin) {
  return typeof origin === "string" && EXTENSION_ORIGIN_PATTERN.test(origin);
}

function applyCors(response, origin) {
  if (isAllowedExtensionOrigin(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }
}

function sendJson(response, status, payload, origin) {
  const body = Buffer.from(JSON.stringify(payload));
  applyCors(response, origin);
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.byteLength,
  });
  response.end(body);
}

function metadataString(metadata, key, maximumLength, { required = false } = {}) {
  const value = metadata[key];
  if (value === undefined || value === null || value === "") {
    if (required) {
      throw new HttpError(400, "INVALID_METADATA", `${key} is required.`);
    }
    return "";
  }
  if (typeof value !== "string" || value.length > maximumLength) {
    throw new HttpError(
      400,
      "INVALID_METADATA",
      `${key} must be a string no longer than ${maximumLength} characters.`,
    );
  }
  return value;
}

function parseMetadata(encodedMetadata) {
  if (typeof encodedMetadata !== "string" || encodedMetadata.length > 16_384) {
    throw new HttpError(400, "INVALID_METADATA", "Capture metadata is missing or too large.");
  }

  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(encodedMetadata, "base64url").toString("utf8"));
  } catch {
    throw new HttpError(400, "INVALID_METADATA", "Capture metadata is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "INVALID_METADATA", "Capture metadata must be an object.");
  }

  const metadata = {
    company: metadataString(parsed, "company", 200),
    position: metadataString(parsed, "position", 300, { required: true }),
    originalUrl: metadataString(parsed, "originalUrl", 8_192, { required: true }),
    capturedAt: metadataString(parsed, "capturedAt", 100, { required: true }),
  };

  let sourceUrl;
  try {
    sourceUrl = new URL(metadata.originalUrl);
  } catch {
    throw new HttpError(400, "INVALID_METADATA", "originalUrl must be a valid URL.");
  }
  if (!new Set(["http:", "https:"]).has(sourceUrl.protocol)) {
    throw new HttpError(400, "INVALID_METADATA", "originalUrl must use HTTP or HTTPS.");
  }
  if (Number.isNaN(Date.parse(metadata.capturedAt))) {
    throw new HttpError(400, "INVALID_METADATA", "capturedAt must be a valid date.");
  }

  return metadata;
}

async function readCapture(request) {
  const declaredLength = Number(request.headers["content-length"] || 0);
  if (declaredLength > MAX_CAPTURE_BYTES) {
    throw new HttpError(413, "CAPTURE_TOO_LARGE", "Capture exceeds the 25 MB limit.");
  }

  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    totalBytes += chunk.byteLength;
    if (totalBytes > MAX_CAPTURE_BYTES) {
      throw new HttpError(413, "CAPTURE_TOO_LARGE", "Capture exceeds the 25 MB limit.");
    }
    chunks.push(chunk);
  }
  if (totalBytes < 100) {
    throw new HttpError(400, "EMPTY_CAPTURE", "Capture is empty or incomplete.");
  }
  return Buffer.concat(chunks);
}

function safeFilename(value) {
  return value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 80);
}

export function createConversionServer({ convert = convertMhtmlToPdf } = {}) {
  return http.createServer((request, response) => {
    void handleRequest(request, response, convert).catch((error) => {
      const origin = request.headers.origin;
      const status = error instanceof HttpError ? error.status : 500;
      const code = error instanceof HttpError ? error.code : "CONVERSION_FAILED";
      const message =
        error instanceof HttpError
          ? error.message
          : "The local converter could not generate the PDF.";
      if (!response.headersSent) {
        sendJson(response, status, { error: code, message }, origin);
      } else {
        response.destroy();
      }
      if (!(error instanceof HttpError)) {
        console.error(error);
      }
    });
  });
}

async function handleRequest(request, response, convert) {
  const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const origin = request.headers.origin;

  if (request.method === "GET" && requestUrl.pathname === "/health") {
    sendJson(response, 200, { status: "ok" }, origin);
    return;
  }

  if (request.method === "OPTIONS" && requestUrl.pathname === "/v1/convert") {
    if (!isAllowedExtensionOrigin(origin)) {
      throw new HttpError(403, "ORIGIN_NOT_ALLOWED", "Only the Manager Chrome extension is allowed.");
    }
    applyCors(response, origin);
    response.writeHead(204, {
      "Access-Control-Allow-Headers": "Content-Type, X-Manager-Metadata",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Max-Age": "600",
    });
    response.end();
    return;
  }

  if (request.method !== "POST" || requestUrl.pathname !== "/v1/convert") {
    throw new HttpError(404, "NOT_FOUND", "Route not found.");
  }
  if (!isAllowedExtensionOrigin(origin)) {
    throw new HttpError(403, "ORIGIN_NOT_ALLOWED", "Only the Manager Chrome extension is allowed.");
  }

  const metadata = parseMetadata(request.headers["x-manager-metadata"]);
  const capture = await readCapture(request);
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "manager-converter-"));
  const input = path.join(temporaryDirectory, "capture.mhtml");
  const output = path.join(temporaryDirectory, "job-description.pdf");

  try {
    await fs.writeFile(input, capture);
    await convert({ input, output, ...metadata });
    const pdf = await fs.readFile(output);
    const filename =
      safeFilename(`${metadata.company}-${metadata.position}`) || `job-description-${Date.now()}`;

    applyCors(response, origin);
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${filename}.pdf"`,
      "Content-Length": pdf.byteLength,
      "Content-Type": "application/pdf",
    });
    response.end(pdf);
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function startConversionServer({
  host = DEFAULT_HOST,
  port = DEFAULT_PORT,
  convert,
} = {}) {
  const server = createConversionServer({ convert });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  return { server, origin: `http://${host}:${actualPort}` };
}

async function main() {
  const configuredPort = Number(process.env.MANAGER_CONVERTER_PORT || DEFAULT_PORT);
  if (!Number.isInteger(configuredPort) || configuredPort < 1 || configuredPort > 65_535) {
    throw new Error("MANAGER_CONVERTER_PORT must be an integer from 1 through 65535.");
  }
  const { server, origin } = await startConversionServer({ port: configuredPort });
  console.log(`Manager PDF converter ready at ${origin}`);
  console.log("Keep this terminal open while using the extension. Press Ctrl+C to stop.");

  const stop = () => server.close(() => process.exit(0));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
