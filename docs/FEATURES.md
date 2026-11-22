# RoleSave Feature Map

A section-by-section map of what RoleSave has today, with the sub-sections under each and what they do. This reflects the current working tree, where the email-forwarding pipeline has been removed and the product is focused on tracking.

## Contents

1. [Browser Extension](#1-browser-extension)
2. [Authentication](#2-authentication)
3. [Applications Dashboard](#3-applications-dashboard)
4. [Application Detail](#4-application-detail)
5. [Actions and Reminders](#5-actions-and-reminders)
6. [Processing Issues (Operations)](#6-processing-issues-operations)
7. [Background Worker](#7-background-worker)
8. [Data and Security Layer](#8-data-and-security-layer)
9. [Shared Packages](#9-shared-packages)
10. [Developer Tooling](#10-developer-tooling)
11. [Out of Scope](#11-out-of-scope)

---

## 1. Browser Extension

Location: `apps/extension`. A Manifest V3 popup that signs into the same account as the dashboard.

### 1.1 Sign in
- Email and password sign-in using the same Supabase account as the web app.
- Sign out button in the popup header.
- **Forgot password?** and **Create account** links open the web app.
- Shows a build hint if Supabase is not configured.

### 1.2 Page detection
- Reads job metadata from the active tab: company, position, URL.
- Parses JSON-LD job postings wherever they sit in the page's data, including the employer's own job identifier (string, `PropertyValue`, or array).
- On a page with several postings, uses one only if it matches the page URL or heading.
- Falls back to page heuristics when structured data is missing or invalid, including the employer's logo text, and warns the user to check the details when they were guessed.
- Company and position fields are editable before saving. They stay empty rather than showing a job board's name.

Duplicate matching uses, in order: the ATS job ID from the URL, then the company plus the employer's job ID (if it contains a digit), then the URL without known tracking parameters. Unknown query parameters are kept, because a missed duplicate can be merged later but a false one loses the job. A save that matches none of those still reuses a role at the same URL, unless both have different job IDs or several roles share that URL.

### 1.3 Save job description
- Captures the active tab as MHTML and uploads it straight to the user's private temporary storage path.
- Creates the application and queues a PDF conversion job.
- Uses an idempotency key, so a retry reuses the same capture session instead of creating a second application.
- Saving runs in the extension's background, so it finishes even if the popup closes. A reopened popup shows **Saving…** until it is done.
- If a save fails, **Retry save** appears on that page, even after the popup was closed. The toolbar icon shows `!`, and other pages list the job under **Not saved**.
- A failed capture whose file has expired can be captured again from its page.
- If the posting is already tracked, reuses that application instead of creating a duplicate. The popup looks the same as a first save and lets the user carry on, because the employer's site shows whether they have already applied. It names the saved record's company and position.

### 1.4 Track "in progress" applications
- After saving, tells the user to continue on the employer site.
- Remembers in-progress applications locally for seven days, up to ten at a time for each account. Another account on the same browser does not see them.
- Saving another job does not disturb them: the popup lists them alongside the current page.
- **I'm not applying to this job** clears that pending record.

### 1.5 Mark as applied
- Reopening the popup after submission offers **Mark as applied**.
- Moves the application from `SAVED` to `APPLIED`, stamps the applied time, and adds an extension-sourced timeline event.
- Idempotent, and never downgrades an application already in a later stage.
- If the application is past Applied or no longer exists, says so and removes it from the in-progress list.
- **Open saved application** jumps to the dashboard record.

---

## 2. Authentication

Location: `apps/web/src/app/auth`, `apps/web/src/proxy.ts`.

### 2.1 Sign in and sign up
- Single auth page with a mode tab for each.
- Email and password validated with Zod (valid email, password of at least 8 characters).
- Field-level error messages.
- Sign-up requires email confirmation, with friendly messages for weak passwords and rate limits.
- Signing up with a registered email says so and points to sign-in. If that email is still unconfirmed, a new confirmation link is sent.
- **Resend confirmation email** appears when sign-in finds an unconfirmed email or a link has expired.
- Return-to-page: signed-out visits to `/dashboard/*` come back after sign-in through a validated `?next=` path. The confirmation email link keeps the same return page.

### 2.1a Email links and password recovery
- `/auth/confirm` verifies sign-up and recovery links, then redirects.
- `/auth/forgot-password` sends a reset link; `/auth/reset-password` sets a new password and ends every other session. Another device stops working once its access token expires, within an hour by default.
- Email templates are in `supabase/templates/`.

### 2.2 Session handling
- Session refresh on every request through the proxy.
- The session cookie is marked Secure in production.
- `/dashboard/*` redirects to `/auth` when signed out.
- `/auth` redirects to `/dashboard` when signed in.

### 2.3 Entry and setup
- `/` redirects to the dashboard when signed in. When signed out it shows the landing page: the sign-in form, the steps, and the Chrome extension section.
- When Supabase is not configured, `/` shows a local setup guide instead.

---

## 3. Roles Dashboard

Location: `apps/web/src/app/dashboard/page.tsx`.

The page is titled **Roles**. The line under the title gives the total and how many are in progress (applied, assessment, interview), and **Add role** sits beside it. Every page in the app shares one content column, so the left edge does not move between pages.

### 3.1 Status tabs
- One tab for all roles and one for each status: Saved, Applied, Assessment, Interview, Offer, Rejected, Withdrawn. Each shows its count.
- Choosing a tab filters the table at once. Choosing the current one goes back to all roles.
- When the tabs do not fit, they scroll sideways, and the last one in view fades to show there are more.

### 3.2 Needs attention
- Compact list of actions that are overdue, have a reminder due, or are due today, one line each. It shows the first five, with a link to the rest.
- The panel is left off the page when no open action is due within a day or has a reminder that has passed, so the roles table starts higher.
- Ticking an action shows as done straight away, and the sidebar count follows.
- Link to the full Actions page.

### 3.3 Tracked roles table
- Columns: company and role, status, applied date with the time since, job description, last updated. The exact update time shows on hover.
- Clicking anywhere on a row opens the role. An icon beside the company name opens the original job posting in a new tab.
- The job description column links to the PDF when it is ready, shows **Saving PDF** while it is being made, and links to the role to retry when it failed.
- Sorted by most recently updated. Clicking a column heading sorts by company, status, applied date, or last updated, and clicking it again reverses the order. Roles with no applied date stay last in both directions.
- Long lists draw 100 roles at a time, with **Show 100 more** and **Show all**. Everything loads either way, so search, filters, and counts cover the whole list.
- The table catches up without a reload: on returning to the tab, and every 15 seconds while a PDF is being made.
- Empty states for no roles and for filters that match nothing.
- When the table does not fit its panel, such as on a phone or tablet, each role becomes a stacked row and a dropdown takes over sorting.

### 3.4 Search and filters
- The search box matches every word typed across company and position, in any order, ignoring case and accents. Press `/` to jump to it and `Esc` to clear it.
- The tab counts follow the search, so they show where the matches are.
- Status, search, and sort are kept in the page address, so Back, Forward, reload, and shared links all return to the same view.
- While a filter or search is on, the toolbar shows how many roles match, with **Clear filters** to reset the status and the search.

### 3.5 Change status from the table
- Each row's status is a dropdown. The row and the counts change at once, and the change is recorded on the timeline as it is on the role's page.
- A message confirms the move and offers **Undo** for 10 seconds. Undoing a move to Saved also restores the applied date that the move cleared.
- If the change can't be saved, the row goes back and the message says why. The page stays put when the connection is lost.

### 3.6 Select, download, and delete
- A checkbox on each row selects it, and the one in the table heading selects every role showing.
- **Export** above the table downloads every role in the current view (after the status filter and search) as an Excel file, with nothing to select first.
- A bar pinned to the bottom of the screen appears once something is selected. It shows the count and offers **Clear**, **Export selected**, and **Delete**.
- **Delete** asks for confirmation, naming the roles, then removes them permanently with their timelines, actions, PDFs, and files. Every permanent change in the app uses this same dialog. It stays open until the work is done, and if the work fails it says so and can be tried again.
- Changing the filter or search drops any selected role that is no longer showing, so a hidden role can't be deleted by accident.
- If some can't be deleted, the page says how many were, and the rest stay selected to try again.

### 3.7 Add a role manually
- Create form with company, position, initial status, applied date, job posting link, and job ID. The link and job ID are marked optional.
- The applied date field is only shown for a status other than Saved, and leaving it blank uses the current time.
- Checks for an existing identical posting first and opens that record (with a notice) instead of creating a duplicate. The same web address counts as the same posting unless both have different job IDs.
- If something is wrong, each field shows its own error and everything typed is kept.
- The applied date cannot be in the future, and a saved role cannot have one.
- Writes an initial timeline event, and rolls back the application if that event fails.

### 3.8 Graceful degradation
- A banner appears when the database migration for actions and files is not applied yet. Existing roles still work.

### 3.9 Dates and long lists
- Dates and times show in the viewer's own time zone, wherever the server runs. Dates typed into a form are read in that zone too.
- Lists load in full however long they are, with no row limit.

### 3.10 Sidebar navigation
- Roles and Actions links with an active state, and sign-out at every screen size.
- A **Processing issues** link appears while any save has failed, and while that page is open.
- Live count badges for actions needing attention and for failed saves. They refresh every 30 seconds, when the tab becomes visible, and right after an action is added, edited, completed, or deleted, or a save is retried.

---

## 4. Role Detail

Location: `apps/web/src/app/dashboard/applications/[id]`.

The main column runs in the order people use it: next actions, timeline, then the details form. The side column holds the job description, files, record, duplicate merge, and delete.

### 4.1 Header
- Company and position, with the status and **View posting** beside them.
- Notice when the user was redirected here because the posting already existed.

### 4.2 Role details
- Edit company, position, job posting link, job ID, and applied date.
- Every edit is recorded as a timeline event.

### 4.3 Timeline
- Chronological history of every event: a heading, evidence text, time, source (extension, manual, system), and any new status.
- Headings use plain words: Job description saved, Marked as applied, Withdrawn, Status changed, and Update. They map from the event types `JD_SAVED`, `MARKED_AS_APPLIED`, `APPLICATION_WITHDRAWN`, `MANUAL_CORRECTION`, and `GENERAL_UPDATE`.
- Every role starts with an entry: "Application created manually" for a role added by hand, and "Saved from the browser extension" for one saved from a job page. Saving the same posting again does not add a second one.

### 4.4 Next actions
- Per-role list of actions (see section 5). **Add action** opens the form in place, and saving or cancelling closes it.

### 4.5 Status
- The status in the header is a dropdown in the same colours as the roles table. Choosing another status saves it at once.
- If the change can't be saved, the dropdown goes back to the stored status and a message says why.
- No-op when the status is already current, and the change is logged on the timeline.
- Going back to Saved clears the applied date, and the timeline records what it was.

### 4.6 Job description document
- Shows capture state and a **View PDF** link (signed URL) once conversion completes.
- When a PDF cannot be made, the panel says why in plain words, for example that the saved page had no readable text.
- **Retry conversion** re-queues a failed capture while the temporary capture still exists. If it has expired, the user is told to capture the page again.

### 4.7 Your files
- Optional upload of the resume or other submitted documents. **Add file** opens the file picker, and the chosen file uploads straight away.
- PDF and DOCX only, 6 MB limit. The browser also checks the contents, so a file that was only renamed is refused.
- Stored in a private bucket, listed with a **Remove** button that asks for confirmation in the app's standard dialog.
- Never enters the PDF conversion queue.

### 4.8 Duplicate role merge
- Folded under **Saved this role twice?** until opened.
- Pick another entry that represents the exact same posting and consolidate it. The app's standard dialog names the chosen entry and asks for confirmation.
- Moves the PDFs, files, actions, and timeline into the kept record.

### 4.9 Record facts
- Applied, added, and updated timestamps, plus the job ID when there is one.

### 4.10 Delete this role
- Permanently deletes the role along with its timeline, temporary capture, stored PDF, and attachments, after asking for confirmation in the same dialog as the Roles page.

---

## 5. Actions and Reminders

Location: `apps/web/src/app/dashboard/actions`, `action-ui.tsx`, `action-item-actions.ts`.

### 5.1 Create and edit an action
- Title (up to 200 characters) with suggestions: Finish application, Follow up on application, Prepare for interview, Send thank-you note.
- Due date, with an optional time that defaults to 9:00 AM local.
- Validation rejects a reminder later than the due time.

### 5.2 In-app reminders
- Options: on the due date only, at due time, 1 day before, 3 days before, or a custom time.
- Reminders show while the dashboard is open or on the next visit. No email or browser notifications.

### 5.3 Grouped action list
- Groups: Overdue, Reminders, Due today, Upcoming, Completed.
- Re-evaluated every 30 seconds.
- Completed actions are folded under their heading until opened.
- Each row links back to its role, except on that role's own page.

### 5.4 Row controls
- Complete or reopen with a checkbox, plus Edit and Delete. Delete asks for confirmation in the app's standard dialog, naming the action and its role.

### 5.5 All actions page
- Full list across every role. The line under the title counts the open actions.

---

## 6. Processing Issues (Operations)

Location: `apps/web/src/app/dashboard/operations`. Linked from the sidebar while a save has failed, and always reachable at `/dashboard/operations`.

### 6.1 Failed job list
- Lists failed captures that need attention, including uploads that did not finish and conversions that exhausted automatic retries, with company, role, processing attempt count, a plain explanation of what went wrong, and failure time. The converter's raw error, which can name server paths, is never shown.
- Count badge in the header.
- Empty state when nothing has failed.

### 6.2 Retry
- **Retry** re-queues the capture for a failed job.
- Validates the capture kind and document replay ID, and reports when the temporary capture is gone.

---

## 7. Background Worker

Location: `apps/worker`.

### 7.1 Capture processing
- Claims queued capture jobs, then converts MHTML to PDF.
- Conversion runs in an isolated, network-restricted container. The converter and its image live in `apps/converter` and are built with `pnpm mhtml:image:build`.
- Uploads each attempt's PDF to its own private storage key. Only the current attempt can publish its PDF and record its size and SHA-256 checksum.
- Validates each job payload with Zod.

### 7.2 Retries
- Failures that may pass on their own, such as a slow conversion or a converter that is not running, are retried up to three attempts, after 5 seconds and then 30 seconds.
- Failures that retrying cannot fix, such as a page with no readable text or an invalid job, fail after one attempt.
- The owner sees a plain message. The full error, including the converter command, goes only to the worker's log.
- Jobs that fail for good surface on the role's page and the Processing Issues page.

### 7.3 Cleanup and retention
- Deletes the temporary capture after a successful conversion, and retries any cleanup that failed.
- Cleans up PDFs left behind by abandoned attempts.
- Marks a save as failed if its upload has not finished after 30 minutes, so it can be retried and is cleaned up like any other failure.
- Failed payloads expire after 7 days by default (`FAILED_PAYLOAD_RETENTION_DAYS`).
- Failed job metadata is purged after 90 days by default (`FAILED_JOB_RETENTION_DAYS`, minimum 30).

### 7.4 Verification script
- `apps/worker/scripts/verify-authorization.ts` checks two-user isolation across the database, storage, and replay paths.
- `apps/worker/scripts/seed-demo.ts` (`pnpm seed:demo`) creates a demo account with sample roles, timeline entries, and actions. It only runs against local Supabase.

---

## 8. Data and Security Layer

Location: `supabase/`.

### 8.1 Core tables
- `applications` (with status, fingerprint, and job ID; the `triage_decision` and `triage_reason` columns remain from an earlier feature and nothing in the app sets them), `application_events`, `documents`, `capture_jobs`, `application_actions`, `application_attachments`.

### 8.2 Storage buckets
- `temporary-captures` for MHTML in transit.
- `job-descriptions` for converted PDFs.
- `application-attachments` for user files (PDF and DOCX, 6 MB).
- All private, with per-user folder policies.

### 8.3 Row-level security
- User-facing tables are scoped to their owners, including parent ownership checks when adding related records. The capture storage deletion queue is available only to the service role.
- Signed-in clients have explicit grants for the operations they use. New public tables created by migrations require explicit client grants.
- The service role is used only by the server and worker, and never ships in the extension or browser bundle.

### 8.4 Duplicate detection
- `application_identity_key` gives each posting a key, in the order described in section 1.2, and a unique index allows one application per key for each user.
- `find_existing_application` runs before a manual create, and `create_capture_session` before a capture. Both check that key, then the same URL with no conflicting job ID.
- URL fallback matching preserves case in paths, retained query parameters, and hash routes, along with the order of repeated query values.
- `merge_duplicate_applications` consolidates records.

### 8.5 Migrations
- Migrations cover the foundation, capture pipeline, email pipeline removal, actions and triage, worker recovery, posting identity, client table grants, plain capture failure messages, and timeline entries for extension saves.

---

## 9. Shared Packages

### 9.1 `@rolesave/types`
- Application statuses, sources, event types and sources, and capture statuses, mirroring the Postgres enums.
- `NEEDS_REVIEW` is a legacy enum value that is excluded from user choices.

### 9.2 `@rolesave/validation`
- Zod schemas for auth credentials, application creation, actions, and capture metadata and queue jobs. Action reminders can be set for any time at or before the due time, regardless of time-zone offset.

### 9.3 `@rolesave/config`
- Shared TypeScript base configuration.

---

## 10. Developer Tooling

| Area | Command | Purpose |
| --- | --- | --- |
| Web and worker | `pnpm dev` | Run the dashboard and capture worker together |
| Web | `pnpm dev:web` | Run the dashboard |
| Extension | `pnpm dev:extension` | Develop the extension |
| Worker | `pnpm dev:worker` | Run the capture worker |
| Quality | `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` | Test, type-check, lint, and build |
| Security | `pnpm test:authorization` | Two-user isolation tests |
| Database | `pnpm supabase:start`, `pnpm supabase:reset` | Local Supabase lifecycle |
| Database | `pnpm test:fingerprint` | Fingerprint SQL tests |
| Converter | `pnpm mhtml:image:build` | Build the isolated converter image |
| Converter | `pnpm converter:verify`, `pnpm converter:verify:image` | Check the converter with local Chrome, or inside its container |
| End to end | `pnpm test:e2e` | Browser tests against the running stack |
| Demo data | `pnpm seed:demo` | Create a local demo account with sample roles |

CI runs from `.github/workflows/ci.yml`: quality checks, database tests, and end-to-end tests against a production build. The `spikes/` folder holds earlier technical experiments.

---

## 11. Out of Scope

RoleSave tracks. It does not submit applications, score resumes, write cover letters, recommend jobs, or send email and browser notifications. Email forwarding and inbox parsing were removed from the current branch.
