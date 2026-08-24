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

## Inbound email adapter contract

Set `INBOUND_EMAIL_DOMAIN` and a random `INBOUND_EMAIL_WEBHOOK_SECRET` of at least
32 characters. An inbound provider adapter can then enqueue a raw RFC 822 message:

```sh
curl --request POST http://127.0.0.1:3000/api/v1/webhooks/inbound-email \
  --header "Authorization: Bearer $INBOUND_EMAIL_WEBHOOK_SECRET" \
  --header "Content-Type: message/rfc822" \
  --header "X-Ledger-Recipient: jobs+<forwarding-token>@$INBOUND_EMAIL_DOMAIN" \
  --header "X-Provider-Message-Id: <stable-provider-message-id>" \
  --data-binary @message.eml
```

The endpoint accepts messages up to 10 MB, stores them in the private
`inbound-emails` bucket, and deduplicates retries by forwarding account and provider
message ID. MIME parsing is handled by the next worker stage.

## Real inbound email with Resend

Resend can provide a managed `*.resend.app` receiving domain, so a custom domain is
not required. Configure these server-only values:

```text
INBOUND_EMAIL_DOMAIN=<managed-domain-from-Resend>.resend.app
RESEND_API_KEY=re_...
RESEND_WEBHOOK_SECRET=whsec_...
```

### Local-only polling (no public hosting)

For a private local installation, `RESEND_WEBHOOK_SECRET` and a public endpoint are
not required. Keep the web app and worker running locally:

```sh
pnpm dev:web
pnpm dev:worker
```

The worker uses `RESEND_API_KEY` to poll the newest received emails every 30 seconds,
queues only messages addressed to a valid Ledger forwarding address, and relies on the
database's provider-message ID constraint to prevent duplicate processing. Set
`RESEND_POLL_INTERVAL_MS` to 10000 or higher to change the interval.

The worker examines the newest 100 messages on each poll. This is sufficient for a
personal local installation; a hosted multi-user deployment should use the signed
webhook adapter described below.

### Optional hosted webhook

In Resend, create a webhook for the `email.received` event pointing to the publicly
accessible URL below:

```text
https://<public-app-host>/api/v1/webhooks/resend
```

The adapter verifies Resend's signed webhook, retrieves the original RFC 822 email,
enforces the same 10 MB limit, and enqueues it through the existing idempotent queue.
The API key is used only on the server to retrieve the received email. The raw email
is deleted from Supabase after the worker finishes, although Resend retains its own
provider copy according to the account's retention policy.

After setting the real receiving domain, disconnect and recreate any address that was
issued for `inbound.localhost.test`. Then add the new `jobs+...@<domain>` address as a
forwarding destination in Gmail or Outlook. For local testing, the Resend webhook URL
must use an HTTPS tunnel; `127.0.0.1` is not reachable from Resend.

### Free local end-to-end simulation

Set the following server-only values in `apps/web/.env.local`:

```text
INBOUND_EMAIL_DOMAIN=inbound.localhost.test
INBOUND_EMAIL_WEBHOOK_SECRET=<at-least-32-random-characters>
ENABLE_EMAIL_SIMULATOR=true
EMAIL_SIMULATOR_BASE_URL=http://127.0.0.1:3000
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

Restart `pnpm dev:web`, create two accounts through `/auth`, and verify that each account sees only its own records. That cross-user check is the remaining Milestone 2 exit condition.

Stop the local stack without deleting its database with:

```sh
pnpm supabase:stop
```

Use `pnpm supabase:reset` only when intentionally recreating local data from migrations and `supabase/seed.sql`.
