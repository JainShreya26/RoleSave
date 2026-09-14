# RoleSave extension

The production Manifest V3 extension signs into the same Supabase account as the dashboard, detects job metadata, captures the active tab as MHTML, and uploads it directly to the user's private temporary path. It does not download a local PDF.

If an upload is interrupted while the popup remains open, **Retry save** reuses the same capture session instead of creating a duplicate application. Failed PDF conversions can be requeued from the application detail page while the temporary capture remains available.

After saving, the popup only confirms that the job description is safe and tells the user to continue on the employer site. RoleSave remembers that in-progress application locally for seven days. When the extension is opened again after submission, **Mark as applied** changes the application from `SAVED` to `APPLIED`, records the application time, and appends an extension-sourced timeline event. Repeated clicks are idempotent and applications already in a later stage are never downgraded.

The build reuses the public Supabase URL and publishable key in `apps/web/.env.local`. The service-role key is never included in the extension bundle.

```sh
pnpm --filter @rolesave/extension build
```

Load `apps/extension/dist` as an unpacked extension in `chrome://extensions`, or click Reload if it is already loaded.

For a complete local run:

1. Add `SUPABASE_SECRET_KEY` to `apps/web/.env.local`.
2. Run `pnpm dev:web` in one terminal.
3. Run `pnpm dev:worker` in another terminal.
4. Open a job posting, open RoleSave, and sign in with the same account as the dashboard.
5. Save the job, then open its dashboard record. Refresh once if the PDF is still processing.
