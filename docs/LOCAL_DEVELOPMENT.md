# Local development

RoleSave runs entirely on your computer without paid services: Supabase in
Docker, the Next.js dashboard, the background worker, and a sandboxed Chromium
container that turns saved pages into PDFs.

## Prerequisites

- Node.js 24 (`.nvmrc` pins it) and pnpm 11.19 or newer
- A Docker-compatible runtime that is running: Docker Desktop, OrbStack, Colima,
  Rancher Desktop, or Podman
- Google Chrome 116 or newer, for the extension and the end-to-end tests

## First run

```sh
pnpm install
pnpm mhtml:image:build
pnpm supabase:start
cp .env.example apps/web/.env.local
pnpm supabase:status
```

Fill in `apps/web/.env.local` from the status output:

| Variable | Value from `supabase status` |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | API URL, usually `http://127.0.0.1:54321` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key (or the anon key) |
| `SUPABASE_SECRET_KEY` | Secret key (or the service role key). Server and worker only. |

If `apps/web/.env.local` already holds hosted values, put the local ones in
`apps/web/.env.development.local` instead. It wins over `.env.local` for
`pnpm dev`, `pnpm dev:worker`, `pnpm seed:demo`, the test scripts, and the
extension's `build:dev`.

Then start the dashboard and the worker together:

```sh
pnpm dev
```

Open [http://127.0.0.1:3100](http://127.0.0.1:3100) and create an account, or
run `pnpm seed:demo` and sign in as `demo@rolesave.test` with the password
`rolesave-demo`. Running it again replaces the demo account. Without Supabase
values, the root page shows a setup guide instead.

`pnpm dev:web` and `pnpm dev:worker` start the two halves separately. Saves wait
in a queue until the worker is running.

## Emails

Local Supabase delivers sign-up and password reset emails to Mailpit at
[http://127.0.0.1:54324](http://127.0.0.1:54324). Links use `site_url` from
`supabase/config.toml`, which matches `http://127.0.0.1:3100`. After changing it,
run `pnpm supabase:stop` and `pnpm supabase:start`. Emails sent before the
change keep their old links.

## The extension

```sh
pnpm --filter @rolesave/extension build:dev
```

Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**,
and choose `apps/extension/dist`. Click **Reload** there after each rebuild.
Sign in with the same account as the dashboard. The development build talks to
local Supabase and opens saved roles at `http://127.0.0.1:3100`.

## The PDF converter

The worker runs `apps/converter/src/convert.mjs` inside the image built by
`pnpm mhtml:image:build`, with no network, a read-only file system, and no Linux
capabilities. Rebuild the image after changing the converter.

| Setting | Default | Notes |
| --- | --- | --- |
| `MHTML_CONVERTER_RUNTIME` | `container` | `local` uses the Chrome on your computer instead. It is faster to iterate with, opens untrusted pages without a sandbox, and is refused when `NODE_ENV=production`. |
| `MHTML_CONTAINER_ENGINE` | `docker` | Set to `podman` to use Podman. |
| `MHTML_CONVERTER_IMAGE` | `rolesave-mhtml-converter:local` | |
| `FAILED_PAYLOAD_RETENTION_DAYS` | `7` | Days a failed save's page is kept for retries. Minimum 1. |
| `FAILED_JOB_RETENTION_DAYS` | `90` | Days a failed save's record is kept. Minimum 30. |

Useful commands:

```sh
pnpm converter:verify          # convert the fixture page with your local Chrome
pnpm converter:verify:image    # the same, inside the container, as the worker runs it
pnpm converter:convert --input page.mhtml --output page.pdf
```

A page with no readable text fails at once with a plain message. Other failures
are retried twice, after 5 and 30 seconds. Saves that fail for good appear on the
role's page and under **Processing issues** in the sidebar, where they can be
retried while the saved page is still kept. The worker's terminal shows the full
error.

## Tests

| Command | Needs | Covers |
| --- | --- | --- |
| `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` | Nothing running | Lint, types, unit tests, builds |
| `pnpm exec supabase test db supabase/tests/database` | Supabase | Row-level security and database functions (pgTAP) |
| `pnpm test:fingerprint` | Supabase, plus the `PG*` settings below | Duplicate matching SQL |
| `pnpm test:authorization` | Supabase | Two-user isolation through the real APIs and storage |
| `pnpm test:e2e` | Supabase, `pnpm dev`, the converter image | The app in Chrome, from sign-up to a saved PDF |

`pnpm test:fingerprint` creates and drops its own database. To use the Supabase
server, as CI does, set
`PGHOST=127.0.0.1 PGPORT=54322 PGUSER=postgres PGPASSWORD=postgres`.

The authorization and end-to-end tests create and delete their own accounts, and
refuse to run against anything but local Supabase.

## Database changes

```sh
pnpm exec supabase migration new describe_the_change
pnpm exec supabase migration up --local          # apply new migrations, keep your data
pnpm exec supabase gen types typescript --local > apps/web/src/lib/supabase/database.types.ts
```

`pnpm supabase:reset` rebuilds the database from every migration and deletes all
local data, including accounts. Run `pnpm seed:demo` afterward for sample data.
`pnpm supabase:stop` stops the stack and keeps its data.

## Troubleshooting

- **`supabase start` cannot connect to Docker.** Start your container runtime
  first, then try again.
- **A save stays on "waiting for the worker".** The worker is not running. Start
  it with `pnpm dev` or `pnpm dev:worker`.
- **"The PDF converter is not available right now."** The worker cannot start
  the converter container. Check that Docker is running and that
  `pnpm mhtml:image:build` succeeded, then use **Retry conversion**.
- **Signing in works but every page sends you back to sign-in.** The app and the
  extension must use the same Supabase project. Check that the URL in
  `.env.development.local` or `.env.local` matches `pnpm supabase:status`.
- **Port 3100 is taken.** Stop the other process, or run
  `pnpm --filter @rolesave/web exec next dev -p 3200 -H 127.0.0.1` and add that
  address to `additional_redirect_urls` in `supabase/config.toml`.
