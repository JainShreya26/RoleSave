# Local development

The application can run locally without paid services. Node.js and pnpm are already configured in this workspace.

## Available now

```sh
pnpm install
pnpm dev:web
```

Without Supabase environment variables, `http://127.0.0.1:3100` shows a setup page. Once Supabase is configured, the root route redirects to sign-in or the protected dashboard.

The web application now includes:

- Cookie-backed sign-up, sign-in, and sign-out
- Session refresh through the Next.js proxy
- Protected application routes
- RLS-scoped application queries
- Manual create, edit, status filter/change, timeline, and delete flows

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

The authenticated **Failed jobs** page shows terminal capture failures and lets the
owning user replay a job while its source payload is retained.

## Local Supabase prerequisite

The repository includes Supabase configuration and migrations, but this machine does not currently have a Docker-compatible container runtime. Install and start one of Docker Desktop, Colima, OrbStack, Podman, or Rancher Desktop before running:

```sh
pnpm supabase:start
pnpm supabase:status
```

Copy `.env.example` to `.env.local`. Use the printed local URL and anonymous key for `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; the local anonymous key acts as the development publishable key. Copy the service-role key only for future server/worker integration. Never put the service-role key in browser or extension code.

If `.env.local` holds hosted values, put the local ones in `apps/web/.env.development.local` instead. It overrides `.env.local` for `pnpm dev`, `pnpm dev:web`, `pnpm dev:worker`, `pnpm test:authorization`, and the extension's `build:dev`.

Restart `pnpm dev` and create an account through `/auth`. It runs the web app and the worker together; `pnpm dev:web` and `pnpm dev:worker` start them separately. Cross-user isolation is
covered automatically by the authorization commands below and in CI.

Automated authorization coverage is available with:

```sh
pnpm test:authorization
pnpm exec supabase test db
```

The first command verifies cross-user database, storage, and replay isolation through
the same Supabase APIs used by the application. The second runs the pgTAP RLS suite.
`pnpm test:fingerprint` runs the standalone SQL regression suites against a
disposable database on a local PostgreSQL server. To use the Supabase stack's server,
as CI does, set `PGHOST=127.0.0.1 PGPORT=54322 PGUSER=postgres PGPASSWORD=postgres`.

Stop the local stack without deleting its database with:

```sh
pnpm supabase:stop
```

Use `pnpm supabase:reset` only when intentionally recreating local data from migrations and `supabase/seed.sql`.

## Testing sign-up and password reset locally

Local Supabase delivers auth emails to Inbucket (`http://127.0.0.1:54324`). Email links are built from `site_url` in `supabase/config.toml`, which matches the web app's local address, `http://127.0.0.1:3100`. After changing `site_url`, run `pnpm supabase:stop` and `pnpm supabase:start`. Emails sent before the change keep their old links.
