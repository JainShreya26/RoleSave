# Local development

The application can run locally without paid services. Node.js and pnpm are already configured in this workspace.

## Available now

```sh
pnpm install
pnpm dev:web
```

Without Supabase environment variables, `http://127.0.0.1:3000` shows a setup page. Once Supabase is configured, the root route redirects to sign-in or the protected dashboard.

The web application now includes:

- Cookie-backed sign-up, sign-in, and sign-out
- Session refresh through the Next.js proxy
- Protected application routes
- RLS-scoped application queries
- Manual create, edit, status filter/change, timeline, and delete flows
- A protected email-connection screen that issues a private forwarding address when
  `INBOUND_EMAIL_DOMAIN` is configured

The verified local PDF spike remains available with:

```sh
pnpm spike:mhtml:serve
```

## Containerized production conversion

The background worker now converts untrusted MHTML in a disposable, networkless
container. Build the image before processing capture jobs:

```sh
pnpm mhtml:image:build
pnpm dev:worker
```

Docker is the default engine. Set `MHTML_CONTAINER_ENGINE=podman` to use Podman.
`MHTML_CONVERTER_RUNTIME=local` is available only for explicit local development;
the worker rejects it when `NODE_ENV=production`.

Failed source payloads are retained for replay for 7 days and failed queue metadata
for 90 days. Override those defaults with `FAILED_PAYLOAD_RETENTION_DAYS` and
`FAILED_JOB_RETENTION_DAYS`. The worker enforces retention hourly.

The authenticated **Failed jobs** page shows terminal capture and email failures and
lets the owning user replay a job while its source payload is retained.

## Real inbound email with Resend

Resend can provide a managed `*.resend.app` receiving domain, so a custom domain is
not required. Configure these server-only values:

```text
INBOUND_EMAIL_DOMAIN=<managed-domain-from-Resend>.resend.app
RESEND_API_KEY=re_...
```

RoleSave runs only on your machine, so it has no public URL and accepts no inbound
HTTP at all. The worker fetches mail from Resend instead. Keep the web app and worker
running locally:

```sh
pnpm dev:web
pnpm dev:worker
```

The worker uses `RESEND_API_KEY` to poll the newest received emails every 30 seconds,
queues only messages addressed to a valid RoleSave forwarding address, and relies on the
database's provider-message ID constraint to prevent duplicate processing. Set
`RESEND_POLL_INTERVAL_MS` to 10000 or higher to change the interval.

The worker examines the newest 100 messages on each poll, so mail arrives only while
the worker is running. If it stays off long enough for more than 100 messages to
accumulate at the forwarding address, the oldest are missed and must be added through
**Import a missed email**.

If a selective Gmail rule misses a message, open **Email connection → Import a missed
email** and paste its sender, subject, and text. Manual imports enter the same private
queue and worker pipeline as forwarded mail. Messages that reach RoleSave but are not
recognized appear under **Needs review → Ignored emails** with a bounded text preview;
they can be restored, classified, and attached to an application there.

After setting the real receiving domain, disconnect and recreate any address that was
issued for `inbound.localhost.test`. Then add the new `jobs+...@<domain>` address as a
forwarding destination in Gmail or Outlook.

### Free local end-to-end simulation

Set the following server-only values in `apps/web/.env.local`:

```text
INBOUND_EMAIL_DOMAIN=inbound.localhost.test
ENABLE_EMAIL_SIMULATOR=true
```

Start `pnpm dev:web`, open **Email connection**, create an address, and use the
**Local flow simulator** to enqueue an event for a tracked application. Then process
all available work once:

```sh
pnpm email:process-once
```

Refresh Applications or Needs review to inspect the result. A matching job ID should
auto-attach; an ambiguous message should create a review task. The simulator is
hard-disabled when `NODE_ENV=production`.

## Local Supabase prerequisite

The repository includes Supabase configuration and migrations, but this machine does not currently have a Docker-compatible container runtime. Install and start one of Docker Desktop, Colima, OrbStack, Podman, or Rancher Desktop before running:

```sh
pnpm supabase:start
pnpm supabase:status
```

Copy `.env.example` to `.env.local`. Use the printed local URL and anonymous key for `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; the local anonymous key acts as the development publishable key. Copy the service-role key only for future server/worker integration. Never put the service-role key in browser or extension code.

Restart `pnpm dev:web` and create an account through `/auth`. Cross-user isolation is
covered automatically by the authorization commands below and in CI.

Automated authorization coverage is available with:

```sh
pnpm test:authorization
pnpm exec supabase test db
```

The first command verifies cross-user database, storage, and replay isolation through
the same Supabase APIs used by the application. The second runs the pgTAP RLS suite.

Stop the local stack without deleting its database with:

```sh
pnpm supabase:stop
```

Use `pnpm supabase:reset` only when intentionally recreating local data from migrations and `supabase/seed.sql`.
