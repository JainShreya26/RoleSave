# Contributing to RoleSave

Thanks for helping. RoleSave is a small project, so a short issue before a large
change saves everyone time. Bug fixes, tests, and documentation fixes are welcome
without asking first.

## Set up

Follow [Getting started](README.md#getting-started) and the
[local development guide](docs/LOCAL_DEVELOPMENT.md). In short:

```sh
pnpm install
pnpm mhtml:image:build
pnpm supabase:start
cp .env.example apps/web/.env.local   # then fill in the values from `pnpm supabase:status`
pnpm dev
```

`pnpm seed:demo` adds a demo account with sample roles, so you do not have to
create data by hand.

## Before you open a pull request

Run the same checks as CI:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

If you changed the database, the worker, or anything a signed-in person does,
also run the suites that need local Supabase:

```sh
pnpm exec supabase test db supabase/tests/database
pnpm test:fingerprint
pnpm test:authorization
pnpm test:e2e
```

`pnpm test:fingerprint` needs `PGHOST=127.0.0.1 PGPORT=54322 PGUSER=postgres PGPASSWORD=postgres`
to use the Supabase database. `pnpm test:e2e` needs the web app and worker
running (`pnpm dev`).

If you changed the converter, rebuild and check the image:

```sh
pnpm mhtml:image:build
pnpm converter:verify:image
```

## Database changes

- Add a new migration with `pnpm exec supabase migration new <name>`. Never edit
  a migration that has already been merged, because existing databases will not
  run it again.
- Every new table needs row-level security and explicit grants for the
  operations clients use.
- Released extensions keep calling the capture functions for weeks after a new
  version ships. Only add optional parameters or extra return columns to
  `create_capture_session`, `retry_capture_upload`, `finalize_capture_upload`,
  `fail_capture_upload`, and `mark_application_applied`. Do not rename or remove
  them.
- Add or update a pgTAP test in `supabase/tests/database` for any new rule.
- Regenerate `apps/web/src/lib/supabase/database.types.ts` with
  `pnpm exec supabase gen types typescript --local` after schema changes.

## Writing style

- Interface text is plain and specific. Say what happened and what to do next.
  Never show raw errors, stack traces, or server details to people.
- Comments explain why the code is the way it is, not what it does.
- Keep personal data out of logs, fixtures, and screenshots. Use
  `example.test` addresses and made-up companies.

## Pull requests

- Keep each pull request to one change, and describe how you tested it.
- Add tests for new behavior and for bugs you fix.
- Update the README or `docs/` when a command, setting, or feature changes, and
  add a line to [CHANGELOG.md](CHANGELOG.md) under **Unreleased**.

## Reporting problems

Use the issue templates for bugs and ideas. Report security problems privately,
as described in [SECURITY.md](SECURITY.md). Everyone taking part is expected to
follow the [code of conduct](CODE_OF_CONDUCT.md).
