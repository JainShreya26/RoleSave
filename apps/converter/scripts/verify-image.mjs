// Runs the converter image the way the worker does, with no network and a
// read-only file system, then checks its output. Build the image first with
// `pnpm mhtml:image:build`.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { UNREADABLE_PAGE_EXIT_CODE } from "../src/convert.mjs";

const executeFile = promisify(execFile);
const converterRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const engine = process.env.MHTML_CONTAINER_ENGINE ?? "docker";
const image = process.env.MHTML_CONVERTER_IMAGE ?? "rolesave-mhtml-converter:local";
const user = typeof process.getuid === "function" && typeof process.getgid === "function"
  ? `${process.getuid()}:${process.getgid()}`
  : "1000:1000";

async function convertInContainer(directory) {
  return executeFile(engine, [
    "run", "--rm", "--network=none", "--read-only", "--cap-drop=ALL",
    "--security-opt=no-new-privileges", "--pids-limit=128", "--memory=768m", "--cpus=1",
    "--shm-size=256m", "--tmpfs=/tmp:rw,nosuid,nodev,noexec,size=128m",
    `--user=${user}`, "--env=HOME=/tmp", `--volume=${directory}:/work:rw`, image,
    "--input", "/work/capture.mhtml", "--output", "/work/job-description.pdf", "--metadata", "/work/metadata.json",
  ], { timeout: 120_000 });
}

async function workDirectory(capture) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "rolesave-converter-image-"));
  await fs.writeFile(path.join(directory, "capture.mhtml"), capture);
  await fs.writeFile(path.join(directory, "metadata.json"), JSON.stringify({
    capturedAt: "2026-08-22T14:10:00-04:00",
    company: "Example Labs",
    originalUrl: "https://jobs.example.test/systems-engineer",
    position: "Systems Engineer",
  }));
  return directory;
}

const page = await workDirectory(await fs.readFile(path.join(converterRoot, "fixtures", "static-job.mhtml")));
const blank = await workDirectory("this is not a job page");
try {
  await convertInContainer(page);
  const pdf = await fs.readFile(path.join(page, "job-description.pdf"));
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-", "output must be a PDF");
  assert.ok(pdf.byteLength > 10_000, "output PDF should contain rendered page content");
  console.log(`Verified ${image} converts the fixture (${Math.ceil(pdf.byteLength / 1024)} KB)`);

  await assert.rejects(convertInContainer(blank), (error) => error.code === UNREADABLE_PAGE_EXIT_CODE,
    `a page with no readable text must exit with code ${UNREADABLE_PAGE_EXIT_CODE}`);
  console.log(`Verified ${image} refuses a page with no readable text`);
} finally {
  await Promise.all([page, blank].map((directory) => fs.rm(directory, { force: true, recursive: true })));
}
