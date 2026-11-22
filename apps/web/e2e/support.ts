import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Reads the same env files as `pnpm dev`. Local values win, because a file
 * never overrides a variable that is already set.
 */
export function loadLocalEnvironment() {
  const webDirectory = path.resolve(__dirname, "..");
  for (const file of [".env.development.local", ".env.local"]) {
    const location = path.join(webDirectory, file);
    if (existsSync(location)) process.loadEnvFile(location);
  }
}

loadLocalEnvironment();

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const publicKey = process.env.SUPABASE_PUBLISHABLE_KEY
  ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ?? "";
const secretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const mailUrl = process.env.E2E_MAIL_URL ?? "http://127.0.0.1:54324";

if (!supabaseUrl || !publicKey || !secretKey) {
  throw new Error("The end-to-end tests need local Supabase values in apps/web/.env.local. See docs/LOCAL_DEVELOPMENT.md.");
}
// The tests create and delete accounts, so they never run against a hosted project.
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(supabaseUrl).hostname)) {
  throw new Error(`Refusing to run end-to-end tests against ${new URL(supabaseUrl).origin}. Use local Supabase.`);
}

const clientOptions = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(supabaseUrl, secretKey, clientOptions);
const createdUserIds = new Set<string>();

export interface TestUser {
  client: SupabaseClient;
  email: string;
  id: string;
  password: string;
}

export function testEmail(label: string) {
  return `e2e-${label}-${randomUUID().slice(0, 8)}@example.test`;
}

export function testPassword() {
  return `${randomBytes(18).toString("base64url")}aA1!`;
}

/** An account that can sign in at once, with a client that acts as that person. */
export async function createUser(label: string): Promise<TestUser> {
  const email = testEmail(label);
  const password = testPassword();
  const created = await admin.auth.admin.createUser({ email, email_confirm: true, password });
  if (created.error || !created.data.user) throw created.error ?? new Error("Could not create a test user.");
  createdUserIds.add(created.data.user.id);

  const client = createClient(supabaseUrl, publicKey, clientOptions);
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
  return { client, email, id: created.data.user.id, password };
}

/** Remembers an account made through the sign-up form, so it is removed afterward. */
export async function trackUserByEmail(email: string) {
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const user = data.users.find((item) => item.email === email);
    if (user) {
      createdUserIds.add(user.id);
      return;
    }
    if (data.users.length < 200) return;
  }
}

export async function deleteCreatedUsers() {
  await Promise.all([...createdUserIds].map(async (id) => {
    await admin.auth.admin.deleteUser(id);
    createdUserIds.delete(id);
  }));
}

export async function signIn(page: Page, user: Pick<TestUser, "email" | "password">) {
  await page.goto("/auth");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

/** A role added the way the dashboard adds one. */
export async function addRole(user: TestUser, role: { company: string; position: string; url?: string }) {
  const { data, error } = await user.client.from("applications").insert({
    applied_at: new Date().toISOString(),
    company: role.company,
    original_url: role.url ?? null,
    position: role.position,
    source: "MANUAL",
    status: "APPLIED",
    user_id: user.id,
  }).select("id").single();
  if (error || !data) throw error ?? new Error("Could not add a test role.");
  return data.id as string;
}

/** The link in the newest email sent to an address, from the local mail catcher. */
export async function emailLink(address: string, pathPart: string) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const search = await fetch(`${mailUrl}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`);
    const { messages = [] } = await search.json() as { messages?: { ID: string }[] };
    if (messages[0]) {
      const message = await (await fetch(`${mailUrl}/api/v1/message/${messages[0].ID}`)).json() as { HTML: string };
      const link = [...message.HTML.matchAll(/href="([^"]+)"/g)]
        .map((match) => match[1].replaceAll("&amp;", "&"))
        .find((href) => href.includes(pathPart));
      if (link) return link;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No email with a ${pathPart} link reached ${address}.`);
}

const fixturePage = readFileSync(path.resolve(__dirname, "../../converter/fixtures/static-job.mhtml"));

/**
 * Saves a page the way the extension does: open a capture session, upload the
 * page archive, and queue it for the worker.
 */
export async function saveJobPage(user: TestUser, role: { company: string; position: string; url: string }, archive: Buffer = fixturePage) {
  const session = await user.client.rpc("create_capture_session", {
    p_captured_at: new Date().toISOString(),
    p_company: role.company,
    p_idempotency_key: randomUUID(),
    p_job_id: null,
    p_original_url: role.url,
    p_position: role.position,
  });
  if (session.error) throw session.error;
  const row = (session.data as { application_id: string; job_id: string; temporary_storage_path: string }[])[0];

  const prepared = await user.client.rpc("retry_capture_upload", { p_job_id: row.job_id });
  if (prepared.error) throw prepared.error;
  const upload = await user.client.storage.from("temporary-captures").upload(row.temporary_storage_path, archive, {
    contentType: "multipart/related",
    upsert: false,
  });
  if (upload.error) throw upload.error;
  const finalized = await user.client.rpc("finalize_capture_upload", { p_job_id: row.job_id });
  if (finalized.error) throw finalized.error;
  return row.application_id;
}
