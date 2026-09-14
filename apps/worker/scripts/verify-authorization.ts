import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.API_URL;
const publicKey = process.env.SUPABASE_PUBLISHABLE_KEY
  ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ?? process.env.ANON_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY
  ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  ?? process.env.SERVICE_ROLE_KEY;

if (!url || !publicKey || !secretKey) {
  throw new Error("Supabase URL, publishable key, and secret key are required for authorization tests.");
}

const configuredUrl: string = url;
const configuredPublicKey: string = publicKey;
const configuredSecretKey: string = secretKey;
const admin = createClient(configuredUrl, configuredSecretKey, { auth: { autoRefreshToken: false, persistSession: false } });
const suffix = randomUUID();
const password = `${randomBytes(24).toString("base64url")}aA1!`;
const createdUserIds: string[] = [];
const storageObjects: { bucket: string; path: string }[] = [];

async function createTestViewer(label: string) {
  const email = `authorization-${label}-${suffix}@example.test`;
  const created = await admin.auth.admin.createUser({ email, email_confirm: true, password });
  if (created.error || !created.data.user) throw created.error ?? new Error("Test user creation failed.");
  createdUserIds.push(created.data.user.id);

  const client = createClient(configuredUrl, configuredPublicKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
  return { client, id: created.data.user.id };
}

async function main() {
  const viewerA = await createTestViewer("a");
  const viewerB = await createTestViewer("b");
  const viewers = [viewerA, viewerB];
  const applicationIds: string[] = [];
  const documentIds: string[] = [];
  const captureJobIds: string[] = [];
  const emailJobIds: string[] = [];

  for (const [index, viewer] of viewers.entries()) {
    const application = await viewer.client
      .from("applications")
      .insert({
        company: `Authorization Owner ${index + 1}`,
        company_normalized: "placeholder",
        position: "Test Engineer",
        position_normalized: "placeholder",
        source: "MANUAL",
        status: "SAVED",
        user_id: viewer.id,
      })
      .select("id")
      .single();
    if (application.error) throw application.error;
    applicationIds.push(application.data.id);

    const temporaryPath = `${viewer.id}/authorization-test/${randomUUID()}.mhtml`;
    const outputPath = `${viewer.id}/authorization-test/${randomUUID()}.pdf`;
    const upload = await viewer.client.storage
      .from("temporary-captures")
      .upload(temporaryPath, Buffer.from("authorization test capture"), { contentType: "application/octet-stream" });
    if (upload.error) throw upload.error;
    storageObjects.push({ bucket: "temporary-captures", path: temporaryPath });

    const document = await viewer.client
      .from("documents")
      .insert({
        application_id: application.data.id,
        capture_status: "FAILED",
        storage_path: outputPath,
        temporary_storage_path: temporaryPath,
        user_id: viewer.id,
      })
      .select("id")
      .single();
    if (document.error) throw document.error;
    documentIds.push(document.data.id);

    const captureJobId = randomUUID();
    const captureJob = await admin.from("capture_jobs").insert({
      application_id: application.data.id,
      attempt_count: 3,
      document_id: document.data.id,
      id: captureJobId,
      idempotency_key: randomUUID(),
      status: "FAILED",
      user_id: viewer.id,
    });
    if (captureJob.error) throw captureJob.error;
    captureJobIds.push(captureJobId);

    const account = await viewer.client.rpc("issue_forwarding_address", { p_domain: "example.test" });
    if (account.error || !account.data?.[0]) throw account.error ?? new Error("Email account creation failed.");
    const rawEmailPath = `${viewer.id}/${account.data[0].id}/${randomUUID()}.eml`;
    const rawUpload = await admin.storage
      .from("inbound-emails")
      .upload(rawEmailPath, Buffer.from("From: test@example.test\r\nSubject: Authorization\r\n\r\nTest"), {
        contentType: "message/rfc822",
      });
    if (rawUpload.error) throw rawUpload.error;
    storageObjects.push({ bucket: "inbound-emails", path: rawEmailPath });

    const emailJobId = randomUUID();
    const emailJob = await admin.from("inbound_email_jobs").insert({
      attempt_count: 3,
      email_account_id: account.data[0].id,
      id: emailJobId,
      provider_message_id: `authorization-${randomUUID()}`,
      status: "FAILED",
      storage_path: rawEmailPath,
      user_id: viewer.id,
    });
    if (emailJob.error) throw emailJob.error;
    emailJobIds.push(emailJobId);
  }

  const [applications, captures, emails] = await Promise.all([
    viewerA.client.from("applications").select("id"),
    viewerA.client.from("capture_jobs").select("id"),
    viewerA.client.from("inbound_email_jobs").select("id"),
  ]);
  if (applications.error) throw applications.error;
  if (captures.error) throw captures.error;
  if (emails.error) throw emails.error;
  assert.deepEqual(applications.data.map((row) => row.id), [applicationIds[0]]);
  assert.deepEqual(captures.data.map((row) => row.id), [captureJobIds[0]]);
  assert.deepEqual(emails.data.map((row) => row.id), [emailJobIds[0]]);

  const crossUpdate = await viewerA.client
    .from("applications")
    .update({ company: "Unauthorized change" })
    .eq("id", applicationIds[1])
    .select("id");
  if (crossUpdate.error) throw crossUpdate.error;
  assert.equal(crossUpdate.data.length, 0);

  const crossStorageRead = await viewerA.client.storage
    .from("temporary-captures")
    .download(storageObjects[2].path);
  assert.ok(crossStorageRead.error, "Cross-user storage download should be denied.");

  const crossCaptureReplay = await viewerA.client.rpc("retry_failed_capture", { p_document_id: documentIds[1] });
  const crossEmailReplay = await viewerA.client.rpc("retry_failed_email_job", { p_job_id: emailJobIds[1] });
  if (crossCaptureReplay.error) throw crossCaptureReplay.error;
  if (crossEmailReplay.error) throw crossEmailReplay.error;
  assert.equal(crossCaptureReplay.data, false);
  assert.equal(crossEmailReplay.data, false);

  const ownCaptureReplay = await viewerA.client.rpc("retry_failed_capture", { p_document_id: documentIds[0] });
  const ownEmailReplay = await viewerA.client.rpc("retry_failed_email_job", { p_job_id: emailJobIds[0] });
  if (ownCaptureReplay.error) throw ownCaptureReplay.error;
  if (ownEmailReplay.error) throw ownEmailReplay.error;
  assert.equal(ownCaptureReplay.data, true);
  assert.equal(ownEmailReplay.data, true);

  console.log("Cross-user database, storage, and replay authorization tests passed.");
}

try {
  await main();
} finally {
  for (const object of storageObjects) {
    await admin.storage.from(object.bucket).remove([object.path]);
  }
  for (const userId of createdUserIds) {
    await admin.auth.admin.deleteUser(userId);
  }
}
