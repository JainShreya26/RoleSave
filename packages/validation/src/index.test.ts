import assert from "node:assert/strict";
import test from "node:test";
import { authCredentialsSchema, captureMetadataSchema, createApplicationSchema, inboundEmailEnvelopeSchema } from "./index";

test("validates and normalizes auth credentials", () => {
  const result = authCredentialsSchema.parse({ email: "  USER@Example.com ", password: "password123" });
  assert.equal(result.email, "user@example.com");
});

test("normalizes application input and supplies the manual source", () => {
  const result = createApplicationSchema.parse({ company: "  Google  ", position: " Engineer " });
  assert.equal(result.company, "Google");
  assert.equal(result.position, "Engineer");
  assert.equal(result.source, "MANUAL");
});

test("rejects non-web capture URLs", () => {
  const result = captureMetadataSchema.safeParse({
    company: "Example", position: "Engineer", originalUrl: "file:///private/job.html", capturedAt: new Date().toISOString(),
  });
  assert.equal(result.success, false);
});

test("normalizes an inbound email envelope", () => {
  const result = inboundEmailEnvelopeSchema.parse({
    providerMessageId: "  provider-message-123  ",
    recipient: "  JOBS+abc@Inbound.Example.com ",
  });
  assert.equal(result.providerMessageId, "provider-message-123");
  assert.equal(result.recipient, "jobs+abc@inbound.example.com");
});
