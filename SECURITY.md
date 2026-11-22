# Security policy

RoleSave stores job applications and copies of job pages, which can include
personal information. Please report security problems privately so they can be
fixed before they are public.

## Reporting a vulnerability

Use GitHub's private reporting:
[report a vulnerability](https://github.com/JainShreya26/RoleSave/security/advisories/new).
Do not open a public issue.

Include what you found, how to reproduce it, and what an attacker could do with
it. You should get a reply within a week. Once a fix is ready, the advisory is
published with credit to you unless you prefer otherwise.

## In scope

- One user reading or changing another user's roles, files, or saved pages.
- Getting the server secret key, or anything it protects, from the browser,
  extension, or worker.
- Escaping the converter container, which opens untrusted pages with no network.
- Authentication or session flaws in the web app or extension.

## Supported versions

Only the latest commit on `main` receives fixes. RoleSave has no releases yet.

## For people running their own copy

- Never put `SUPABASE_SECRET_KEY` in the extension or in any `NEXT_PUBLIC_`
  variable.
- Run the worker with `MHTML_CONVERTER_RUNTIME=container`. The `local` runtime
  opens untrusted pages in the host's Chrome and is refused in production.
- Keep local `.env` files and captured job pages out of version control.
