import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  addRole,
  createUser,
  deleteCreatedUsers,
  emailLink,
  saveJobPage,
  signIn,
  testEmail,
  testPassword,
  trackUserByEmail,
} from "./support";

test.afterAll(deleteCreatedUsers);

function localDay(offsetDays: number) {
  const day = new Date(Date.now() + offsetDays * 86_400_000);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}

test("a new account confirms its email and reaches the dashboard", async ({ page }) => {
  const email = testEmail("signup");
  await page.goto("/auth");
  await page.getByRole("tab", { name: "Create account" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(testPassword());
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Check your email to confirm your address")).toBeVisible();
  await trackUserByEmail(email);

  await page.goto(await emailLink(email, "/auth/confirm"));
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Roles", exact: true })).toBeVisible();
  await expect(page.getByText("No roles here yet")).toBeVisible();
});

test("a role moves from added to interview, with its timeline and actions", async ({ page }) => {
  const user = await createUser("track");
  await signIn(page, user);

  await page.getByRole("button", { name: "Add role" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add a role" });
  await dialog.getByLabel("Company").fill("Acme Robotics");
  await dialog.getByLabel("Position").fill("Senior Platform Engineer");
  await dialog.getByLabel("Job posting link").fill("https://boards.greenhouse.io/acme/jobs/4455667");
  await dialog.getByRole("button", { name: "Add role" }).click();

  await expect(page).toHaveURL(/\/dashboard\/applications\/[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { name: "Acme Robotics" })).toBeVisible();
  await expect(page.getByText("Application created manually")).toBeVisible();

  await page.getByLabel("Status").selectOption("INTERVIEW");
  await expect(page.getByText("Status updated.")).toBeVisible();
  await expect(page.getByText("Status changed manually from Applied to Interview")).toBeVisible();
  await expect(page.getByText("Status changed", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Add action" }).first().click();
  const actionForm = page.locator("form").filter({ has: page.getByPlaceholder("Follow up with recruiter") });
  await actionForm.getByPlaceholder("Follow up with recruiter").fill("Send thank-you note");
  await actionForm.getByRole("textbox", { name: "Due date" }).fill(localDay(-1));
  await actionForm.getByRole("button", { name: "Add action" }).click();
  await expect(page.getByText("Send thank-you note")).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Overdue 1/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Actions, 1 need attention" })).toBeVisible();

  await page.getByRole("link", { name: /^Actions/ }).click();
  await expect(page.getByText("Send thank-you note")).toBeVisible();
  await expect(page.getByText("Acme Robotics · Senior Platform Engineer")).toBeVisible();
});

test("the same posting is never tracked twice", async ({ page }) => {
  const user = await createUser("duplicate");
  const existing = await addRole(user, {
    company: "Globex",
    position: "Staff Data Engineer",
    url: "https://jobs.lever.co/globex/1b2c3d4e-0000-4000-8000-123456789abc",
  });
  await signIn(page, user);

  await page.getByRole("button", { name: "Add role" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add a role" });
  await dialog.getByLabel("Company").fill("Globex Corporation");
  await dialog.getByLabel("Position").fill("Data Engineer");
  await dialog.getByLabel("Job posting link").fill("https://jobs.lever.co/globex/1b2c3d4e-0000-4000-8000-123456789abc?utm_source=linkedin");
  await dialog.getByRole("button", { name: "Add role" }).click();

  await expect(page).toHaveURL(new RegExp(`/dashboard/applications/${existing}\\?existing=1`));
  await page.goto("/dashboard");
  await expect(page.getByText("1 role tracked")).toBeVisible();
});

test("roles download as an Excel file", async ({ page }) => {
  const user = await createUser("export");
  await addRole(user, { company: "Initech", position: "Backend Engineer" });
  await signIn(page, user);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export", exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^rolesave-applications-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const file = await readFile(await download.path());
  expect(file.subarray(0, 2).toString()).toBe("PK");
});

test("a saved job page becomes a PDF, and an unreadable one explains itself", async ({ page }) => {
  // Needs the worker running with the converter image.
  const user = await createUser("capture");
  const saved = await saveJobPage(user, {
    company: "Northwind Analytics",
    position: "Senior Data Engineer",
    url: "https://boards.greenhouse.io/northwind/jobs/4101001",
  });
  const unreadable = await saveJobPage(user, {
    company: "Blank Page Co",
    position: "Engineer",
    url: "https://jobs.example.test/blank",
  }, Buffer.from("this is not a job page"));
  await signIn(page, user);

  await page.goto(`/dashboard/applications/${saved}`);
  await expect(page.getByText("Saved from the browser extension")).toBeVisible();
  await expect(page.getByText("Your private PDF is ready.")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Job description saved", { exact: true })).toBeVisible();

  await page.goto(`/dashboard/applications/${unreadable}`);
  await expect(page.getByText(/no readable text/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Retry conversion" })).toBeVisible();

  await page.goto("/dashboard");
  await page.getByRole("link", { name: "Processing issues, 1 failed" }).click();
  await expect(page).toHaveURL(/\/dashboard\/operations$/);
  const card = page.locator(".failed-job-card");
  await expect(card).toContainText("Blank Page Co");
  await expect(card).toContainText("no readable text");
  // A failure that retrying cannot fix is reported after one attempt.
  await expect(card).toContainText("1 processing attempt");
  await expect(card).not.toContainText(/docker|Command failed|\/work\//);
});

test("one account cannot open another account's role", async ({ page }) => {
  const owner = await createUser("owner");
  const other = await createUser("other");
  const roleId = await addRole(owner, { company: "Private Co", position: "Secret Role" });
  await signIn(page, other);

  const response = await page.goto(`/dashboard/applications/${roleId}`);
  expect(response?.status()).toBe(404);
  await expect(page.getByText("Private Co")).toHaveCount(0);
});

test("signing out closes the dashboard", async ({ page }) => {
  const user = await createUser("signout");
  await signIn(page, user);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/auth/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/auth\?next=%2Fdashboard/);
});
