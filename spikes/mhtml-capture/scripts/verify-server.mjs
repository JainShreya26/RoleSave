import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startConversionServer } from "./server.mjs";

const spikeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const capture = await fs.readFile(path.join(spikeRoot, "fixtures", "static-job.mhtml"));
const metadata = {
  company: "Example Labs",
  position: "Systems Engineer",
  originalUrl: "https://jobs.example.test/systems-engineer",
  capturedAt: "2026-08-22T14:10:00-04:00",
};
const extensionOrigin = `chrome-extension://${"a".repeat(32)}`;
const encodedMetadata = Buffer.from(JSON.stringify(metadata)).toString("base64url");
const { server, origin } = await startConversionServer({ port: 0 });

try {
  const health = await fetch(`${origin}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok" });

  const denied = await fetch(`${origin}/v1/convert`, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Origin": "https://untrusted.example",
      "X-RoleSave-Metadata": encodedMetadata,
    },
    body: capture,
  });
  assert.equal(denied.status, 403);

  const response = await fetch(`${origin}/v1/convert`, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Origin": extensionOrigin,
      "X-RoleSave-Metadata": encodedMetadata,
    },
    body: capture,
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), extensionOrigin);
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.match(response.headers.get("content-disposition") || "", /\.pdf"$/);

  const pdf = Buffer.from(await response.arrayBuffer());
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdf.byteLength > 10_000);
  await fs.writeFile(path.join(spikeRoot, "output", "server-static-job.pdf"), pdf);
  console.log(`Verified localhost conversion (${Math.ceil(pdf.byteLength / 1024)} KB PDF)`);
} finally {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
