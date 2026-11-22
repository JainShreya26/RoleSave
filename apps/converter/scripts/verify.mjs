// Converts the fixture page with the Chrome on this computer and checks the PDF.
// Set MHTML_CHROME_PATH if Chrome is not in a usual place.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { convertMhtmlToPdf, UnreadablePageError } from "../src/convert.mjs";

const converterRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const input = path.join(converterRoot, "fixtures", "static-job.mhtml");
const workDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rolesave-converter-verify-"));

try {
  const output = path.join(workDirectory, "static-job.pdf");
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
  console.log(`Verified the fixture PDF (${Math.ceil(pdf.byteLength / 1024)} KB)`);

  const blank = path.join(workDirectory, "blank.mhtml");
  await fs.writeFile(blank, "this is not a job page");
  await assert.rejects(
    convertMhtmlToPdf({ input: blank, output: path.join(workDirectory, "blank.pdf") }),
    UnreadablePageError,
    "a page with no readable text must be refused",
  );
  console.log("Verified that a page with no readable text is refused");
} finally {
  await fs.rm(workDirectory, { force: true, recursive: true });
}
