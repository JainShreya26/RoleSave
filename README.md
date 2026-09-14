# RoleSave

RoleSave is a private job-application tracker that keeps saved roles, application
updates, and related email in one place.

Save a job description from the browser, mark the role as applied, and let incoming
email update the application timeline when confirmations, assessments, interviews,
rejections, or offers arrive.

## What RoleSave does

- Saves job descriptions before listings disappear.
- Records applications from the browser extension or confirmation email.
- Classifies common application-related email events.
- Matches email updates to existing applications.
- Sends uncertain matches to a review queue instead of guessing.
- Shows application status and evidence in a private web dashboard.
- Preserves a chronological history for every application.

RoleSave is focused on tracking. It does not submit applications, score resumes,
write cover letters, or recommend jobs.

## Project structure

```text
apps/
  extension/   Browser extension for saving roles and capturing job pages
  web/         Next.js dashboard, authentication, and inbound-email API
  worker/      Email parsing, classification, matching, and background processing
packages/
  config/      Shared configuration
  database/    Shared database schema
  types/       Shared TypeScript types
  validation/  Shared input validation
supabase/      Local configuration, migrations, and seed data
spikes/        Isolated technical experiments
docs/          Development notes and implementation roadmap
```

## Technology

- TypeScript monorepo managed with pnpm
- Next.js and React for the web application
- React and Vite for the browser extension
- Supabase for authentication, PostgreSQL, and private file storage
- Resend for inbound email

## Getting started

### Prerequisites

- Node.js
- pnpm 11.19 or newer
- A Docker-compatible runtime for local Supabase and isolated PDF conversion

Install dependencies:

```sh
pnpm install
pnpm mhtml:image:build
```

Start the local Supabase stack:

```sh
pnpm supabase:start
pnpm supabase:status
```

Copy the example environment configuration:

```sh
cp .env.example apps/web/.env.local
```

Replace the placeholders in `apps/web/.env.local` with the local values printed by
Supabase. Keep `SUPABASE_SECRET_KEY`, Resend credentials, and webhook secrets on the
server only.

Start the web application:

```sh
pnpm dev:web
```

Then open [http://127.0.0.1:3000](http://127.0.0.1:3000).

Run the extension or email worker in another terminal when needed:

```sh
pnpm dev:extension
pnpm dev:worker
```

For detailed Supabase, inbound-email, Resend, and simulator instructions, see
[Local development](docs/LOCAL_DEVELOPMENT.md).

## Common commands

| Command | Purpose |
| --- | --- |
| `pnpm dev:web` | Start the web dashboard |
| `pnpm dev:extension` | Start browser-extension development |
| `pnpm dev:worker` | Start the email worker |
| `pnpm email:process-once` | Process currently queued email once |
| `pnpm test` | Run the test suite |
| `pnpm test:authorization` | Run two-user database, storage, and replay isolation tests |
| `pnpm mhtml:image:build` | Build the isolated MHTML converter image |
| `pnpm typecheck` | Type-check all workspaces |
| `pnpm lint` | Run configured linters |
| `pnpm build` | Build all buildable workspaces |
| `pnpm supabase:reset` | Recreate local data from migrations and seed data |

## Documentation

- [Product and technical specification](PROJECT_SPEC.md)
- [Implementation roadmap](docs/IMPLEMENTATION_ROADMAP.md)
- [Local development guide](docs/LOCAL_DEVELOPMENT.md)

## Status

RoleSave is under active MVP development and is not ready for production use.

## Privacy

Application data, email content, and saved job descriptions can contain sensitive
personal information. Keep deployments private, use server-only credentials for
privileged operations, and never commit local environment files or captured job data.
