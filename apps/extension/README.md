# RoleSave extension

The production Manifest V3 extension signs into the same Supabase account as the dashboard, detects job metadata, captures the active tab as MHTML, and uploads it directly to the user's private temporary path. It does not download a local PDF.

Saving runs in a background service worker, so it continues if the popup closes. If a save fails, **Retry save** appears on that page and reuses the same capture session instead of creating a duplicate application. Failed PDF conversions can be requeued from the application detail page while the temporary capture remains available.

After saving, the popup only confirms that the job description is safe and tells the user to continue on the employer site. RoleSave remembers in-progress applications locally for seven days, and you can save other jobs in the meantime. When the extension is opened again after submission, **Mark as applied** changes the application from `SAVED` to `APPLIED`, records the application time, and appends an extension-sourced timeline event. Repeated clicks are idempotent and applications already in a later stage are never downgraded.

For local work, use the development build. It reads the public Supabase URL and publishable key from `apps/web/.env.local`, and `apps/web/.env.development.local` overrides them if it exists. The service-role key is never included in the extension bundle.

```sh
pnpm --filter @rolesave/extension build:dev
```

For a release build without localhost permissions, set the production Supabase values and `NEXT_PUBLIC_SITE_URL` in the environment, then run `pnpm --filter @rolesave/extension build`.

Load `apps/extension/dist` as an unpacked extension in `chrome://extensions`, or click Reload if it is already loaded.

For a complete local run:

1. Add `SUPABASE_SECRET_KEY` to the same env file as your local Supabase URL.
2. Run `pnpm dev` to start the web app and the worker. Saves wait in a queue until the worker is running.
3. Keep that terminal open while you use the extension.
4. Open a job posting, open RoleSave, and sign in with the same account as the dashboard.
5. Save the job, then open its dashboard record. Refresh once if the PDF is still processing.
