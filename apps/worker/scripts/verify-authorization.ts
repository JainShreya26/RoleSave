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
  const actionIds: string[] = [];
  const attachmentPaths: string[] = [];

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

    const action = await viewer.client.from("application_actions").insert({
      application_id: application.data.id,
      user_id: viewer.id,
      title: "Follow up",
      due_at: new Date(Date.now() + 86_400_000).toISOString(),
    }).select("id").single();
    if (action.error) throw action.error;
    actionIds.push(action.data.id);

    const attachmentPath = `${viewer.id}/${randomUUID()}.pdf`;
    const attachmentFile = Buffer.from("%PDF-1.4\nauthorization test\n");
    const attachmentUpload = await viewer.client.storage.from("application-attachments")
      .upload(attachmentPath, attachmentFile, { contentType: "application/pdf" });
    if (attachmentUpload.error) throw attachmentUpload.error;
    storageObjects.push({ bucket: "application-attachments", path: attachmentPath });
    attachmentPaths.push(attachmentPath);
    const attachment = await viewer.client.from("application_attachments").insert({
      application_id: application.data.id,
      user_id: viewer.id,
      file_name: "resume.pdf",
      mime_type: "application/pdf",
      file_size_bytes: attachmentFile.byteLength,
      storage_path: attachmentPath,
    });
    if (attachment.error) throw attachment.error;

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
  }

  const [applications, captures, actions, attachments] = await Promise.all([
    viewerA.client.from("applications").select("id"),
    viewerA.client.from("capture_jobs").select("id"),
    viewerA.client.from("application_actions").select("id"),
    viewerA.client.from("application_attachments").select("storage_path"),
  ]);
  if (applications.error) throw applications.error;
  if (captures.error) throw captures.error;
  if (actions.error) throw actions.error;
  if (attachments.error) throw attachments.error;
  assert.deepEqual(applications.data.map((row) => row.id), [applicationIds[0]]);
  assert.deepEqual(captures.data.map((row) => row.id), [captureJobIds[0]]);
  assert.deepEqual(actions.data.map((row) => row.id), [actionIds[0]]);
  assert.deepEqual(attachments.data.map((row) => row.storage_path), [attachmentPaths[0]]);

  const crossUpdate = await viewerA.client
    .from("applications")
    .update({ company: "Unauthorized change" })
    .eq("id", applicationIds[1])
    .select("id");
  if (crossUpdate.error) throw crossUpdate.error;
  assert.equal(crossUpdate.data.length, 0);

  const crossActionUpdate = await viewerA.client.from("application_actions")
    .update({ title: "Unauthorized change" }).eq("id", actionIds[1]).select("id");
  if (crossActionUpdate.error) throw crossActionUpdate.error;
  assert.equal(crossActionUpdate.data.length, 0);

  const crossActionInsert = await viewerA.client.from("application_actions").insert({
    application_id: applicationIds[1],
    user_id: viewerA.id,
    title: "Unauthorized action",
    due_at: new Date(Date.now() + 86_400_000).toISOString(),
  });
  assert.ok(crossActionInsert.error, "Cannot add an action to another user's role.");

  const crossStorageRead = await viewerA.client.storage
    .from("temporary-captures")
    .download(storageObjects[2].path);
  assert.ok(crossStorageRead.error, "Cross-user storage download should be denied.");
  const crossAttachmentRead = await viewerA.client.storage
    .from("application-attachments").download(attachmentPaths[1]);
  assert.ok(crossAttachmentRead.error, "Cross-user application file download should be denied.");

  const crossCaptureReplay = await viewerA.client.rpc("retry_failed_capture", { p_document_id: documentIds[1] });
  if (crossCaptureReplay.error) throw crossCaptureReplay.error;
  assert.equal(crossCaptureReplay.data, false);

  const ownCaptureReplay = await viewerA.client.rpc("retry_failed_capture", { p_document_id: documentIds[0] });
  if (ownCaptureReplay.error) throw ownCaptureReplay.error;
  assert.equal(ownCaptureReplay.data, true);

  console.log("Cross-user application, action, file, storage, and replay authorization tests passed.");
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
