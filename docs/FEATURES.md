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

## 3. Applications Dashboard

Location: `apps/web/src/app/dashboard/page.tsx`.

### 3.1 Summary cards
- Tracked roles, To decide (saved roles with no decision), Active (applied, assessment, interview), and Interviews.

### 3.2 Needs attention
- Compact list of actions that are overdue, have a reminder due, or are due today. It shows the first five, with a link to the rest.
- Link to the full Actions page.

### 3.3 Tracked roles table
- Columns: company and role, applied date, status, decision, JD document state, last updated.
- Sorted by most recently updated.
- Empty states for no roles and for filters that match nothing.
- When the table does not fit its panel, such as on a phone or tablet, each role becomes a stacked row.

### 3.4 Filters
- Filtering updates the table without leaving the page. The dropdowns follow **Clear** and the Back button.
- Status filter: Saved, Applied, Assessment, Interview, Offer, Rejected, Withdrawn.
- Decision filter: Active (default, hides passed saved roles), Not reviewed, Pursue, Maybe, Pass, All.
- Clear link resets both.

### 3.5 Quick triage
- Inline decision control on saved roles, so a role can be marked Pursue, Maybe, or Pass without opening it.

### 3.6 Add a role manually
- Create form with company, position, URL, job ID, applied date, and initial status.
- Checks for an existing identical posting first and opens that record (with a notice) instead of creating a duplicate. The same web address counts as the same posting unless both have different job IDs.
- If something is wrong, each field shows its own error and everything typed is kept.
- The applied date cannot be in the future, and a saved role cannot have one.
- Writes an initial timeline event, and rolls back the application if that event fails.

### 3.7 Graceful degradation
- A banner appears when the database migration for decisions, actions, and files is not applied yet. Existing roles still work.

### 3.8 Dates and long lists
- Dates and times show in the viewer's own time zone, wherever the server runs. Dates typed into a form are read in that zone too.
- Lists load in full however long they are, with no row limit.

### 3.9 Sidebar navigation
- Applications and Actions links with an active state, and sign-out at every screen size.
- Live count badge for actions needing attention, refreshed every 30 seconds and when the tab becomes visible. Actions on passed saved roles are excluded.

---

## 4. Application Detail

Location: `apps/web/src/app/dashboard/applications/[id]`.

### 4.1 Header
- Company, position, and current status badge.
- Notice when the user was redirected here because the posting already existed.

### 4.2 Application details
- Edit company, position, URL, job ID, and applied date.
- Every edit is recorded as a timeline event.

### 4.3 Timeline
- Chronological history of every event: type, evidence text, time, source (extension, manual, system), and any new status.
- Event types: `JD_SAVED`, `MARKED_AS_APPLIED`, `APPLICATION_WITHDRAWN`, `GENERAL_UPDATE`, `MANUAL_CORRECTION`.

### 4.4 Next actions
- Per-role list of actions plus an "Add an action" form (see section 5).

### 4.5 Worth pursuing? (triage panel)
- Decision: Not reviewed, Pursue, Maybe, or Pass, with an optional reason up to 500 characters.
- Only available while the role is `SAVED`.
- Each change is logged on the timeline.

### 4.6 Status
- Manual status change across the selectable statuses.
- No-op when the status is already current, and the change is logged on the timeline.
- Going back to Saved clears the applied date, and the timeline records what it was.

### 4.7 Job description document
- Shows capture state and a **View PDF** link (signed URL) once conversion completes.
- **Retry conversion** re-queues a failed capture while the temporary capture still exists. If it has expired, the user is told to capture the page again.

### 4.8 Application files
- Optional upload of the resume or other submitted documents.
- PDF and DOCX only, 6 MB limit. The browser also checks the contents, so a file that was only renamed is refused.
- Stored in a private bucket, listed with a **Remove** button.
- Never enters the PDF conversion queue.

### 4.9 Duplicate application merge
- Pick another entry that represents the exact same posting and consolidate it.
- Moves the PDFs, files, actions, and timeline into the kept record, and preserves the saved-role decision. If both have a decision, the kept record's decision and reason stay.

### 4.10 Record facts
- Applied, created, and updated timestamps, plus job ID.
- **Open original page** link.

### 4.11 Danger zone
- Permanently deletes the application along with its timeline, temporary capture, stored PDF, and attachments.

---

## 5. Actions and Reminders

Location: `apps/web/src/app/dashboard/actions`, `action-ui.tsx`, `action-item-actions.ts`.

### 5.1 Create and edit an action
- Title (up to 200 characters) with suggestions: Finish application, Follow up on application, Prepare for interview, Send thank-you note.
- Due date, with an optional time that defaults to 9:00 AM local.
- Validation rejects a reminder later than the due time.

### 5.2 In-app reminders
- Options: at due date only, at due time, 1 day before, 3 days before, or a custom time.
- Reminders show while the dashboard is open or on the next visit. No email or browser notifications.

### 5.3 Grouped action list
- Groups: Overdue, Reminders, Due today, Upcoming, Paused for passed roles, Completed.
- Re-evaluated every 30 seconds.
- Each row links back to its role.

### 5.4 Row controls
- Complete or reopen with a checkbox, plus Edit and Delete (with a confirm prompt).

### 5.5 Pass pauses actions
- Actions on a saved role marked Pass move to "Paused" and are excluded from attention counts until the decision changes.

### 5.6 All actions page
- Full list across every role, with a link back to Applications.

---

## 6. Processing Issues (Operations)

Location: `apps/web/src/app/dashboard/operations`. Reached by URL, and not linked in the sidebar.

### 6.1 Failed job list
- Lists capture jobs that exhausted automatic retries, with company, role, attempt count, last error, and failure time.
- Count badge in the header.
- Empty state when nothing has failed.

### 6.2 Retry
- **Retry** re-queues the capture for a failed job.
- Validates the job ID and kind, and reports when the temporary capture is gone.

---

## 7. Background Worker

Location: `apps/worker`.

### 7.1 Capture processing
- Claims queued capture jobs, then converts MHTML to PDF.
- Conversion runs in an isolated, network-restricted container (built with `pnpm mhtml:image:build`).
- Uploads the PDF to private storage, then records its size and SHA-256 checksum.
- Validates each job payload with Zod.

### 7.2 Retries
- Failed jobs are retried automatically with attempt counting.
- Jobs that exhaust retries surface on the Processing Issues page.

### 7.3 Cleanup and retention
- Deletes the temporary capture after a successful conversion, and retries any cleanup that failed.
- Marks a save as failed if its upload has not finished after 30 minutes, so it can be retried and is cleaned up like any other failure.
- Failed payloads expire after 7 days by default (`FAILED_PAYLOAD_RETENTION_DAYS`).
- Failed job metadata is purged after 90 days by default (`FAILED_JOB_RETENTION_DAYS`, minimum 30).

### 7.4 Verification script
- `scripts/verify-authorization.ts` checks two-user isolation across the database, storage, and replay paths.

---

## 8. Data and Security Layer

Location: `supabase/`.

### 8.1 Core tables
- `applications` (with status, triage decision and reason, fingerprint, and job ID), `application_events`, `documents`, `capture_jobs`, `application_actions`, `application_attachments`.

### 8.2 Storage buckets
- `temporary-captures` for MHTML in transit.
- `job-descriptions` for converted PDFs.
- `application-attachments` for user files (PDF and DOCX, 6 MB).
- All private, with per-user folder policies.

### 8.3 Row-level security
- Every table is scoped to its owning user, including inserts that check ownership of the parent application.
- The service role is used only by the server and worker, and never ships in the extension or browser bundle.

### 8.4 Duplicate detection
- `application_identity_key` gives each posting a key, in the order described in section 1.2, and a unique index allows one application per key for each user.
- `find_existing_application` runs before a manual create, and `create_capture_session` before a capture. Both check that key, then the same URL with no conflicting job ID.
- `merge_duplicate_applications` consolidates records.

### 8.5 Migrations
- The history runs from foundation, through the capture pipeline, reliability work, deduplication, and the removal of the email pipeline, up to `actions_and_triage`.

---

## 9. Shared Packages

### 9.1 `@rolesave/types`
- Application statuses, sources, event types and sources, and capture statuses, mirroring the Postgres enums.
- `NEEDS_REVIEW` is a legacy enum value that is excluded from user choices.

### 9.2 `@rolesave/validation`
- Zod schemas for auth credentials, application creation, triage, actions (with the reminder-before-due rule), and capture metadata and queue jobs.

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

CI runs from `.github/workflows/ci.yml`. The `spikes/` folder holds isolated technical experiments.

---

## 11. Out of Scope

RoleSave tracks. It does not submit applications, score resumes, write cover letters, recommend jobs, or send email and browser notifications. Email forwarding and inbox parsing were removed from the current branch.
