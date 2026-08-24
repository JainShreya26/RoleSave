import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { convertMhtmlToPdf } from "./convert.mjs";

const spikeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const input = path.join(spikeRoot, "fixtures", "static-job.mhtml");
const output = path.join(spikeRoot, "output", "static-job.pdf");

await convertMhtmlToPdf({
  input,
  output,
  company: "Example Labs",
  position: "Systems Engineer",
  originalUrl: "https://jobs.example.test/systems-engineer",
  capturedAt: "2026-08-22T14:10:00-04:00",
});

const pdf = await fs.readFile(output);
assert.equal(pdf.subarray(0, 5).toString(), "%PDF-", "output must be a PDF");
assert.ok(pdf.byteLength > 10_000, "output PDF should contain rendered page content");

console.log(`Verified ${output} (${Math.ceil(pdf.byteLength / 1024)} KB)`);
