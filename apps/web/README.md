# RoleSave web

The authenticated Next.js dashboard for RoleSave. It provides application tracking,
saved job-description access, email activity, match review, and account-scoped
recovery controls.

Run commands from the repository root:

```sh
pnpm dev:web
pnpm --filter @rolesave/web typecheck
pnpm --filter @rolesave/web lint
pnpm --filter @rolesave/web build
```

Environment setup and local email-flow instructions live in
[`docs/LOCAL_DEVELOPMENT.md`](../../docs/LOCAL_DEVELOPMENT.md).
