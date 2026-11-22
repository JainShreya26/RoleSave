# RoleSave web

The authenticated Next.js dashboard for RoleSave. It provides application tracking,
dated actions with in-app reminders, optional private file uploads, saved
job-description access, and retries for saves that could not become a PDF.

Run commands from the repository root:

```sh
pnpm dev:web
pnpm --filter @rolesave/web typecheck
pnpm --filter @rolesave/web lint
pnpm --filter @rolesave/web build
pnpm test:e2e
```

`pnpm test:e2e` runs the Playwright tests in `e2e/` against the app at
`http://127.0.0.1:3100`, using your installed Chrome. Start local Supabase,
`pnpm dev`, and build the converter image first. The tests create and delete
their own accounts, and refuse to run against anything but local Supabase. Set
`E2E_BASE_URL` to test another address.

Environment setup and local development instructions live in
[`docs/LOCAL_DEVELOPMENT.md`](../../docs/LOCAL_DEVELOPMENT.md).
