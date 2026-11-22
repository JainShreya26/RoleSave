# Changelog

Notable changes to RoleSave. RoleSave has no releases yet, so everything is under
**Unreleased** until the first one.

## Unreleased

### Added

- Roles list with search, status tabs, sorting, bulk selection, bulk delete, and
  Excel export.
- Browser end-to-end tests (`pnpm test:e2e`) covering sign-up, tracking a role,
  duplicates, export, saving a page as a PDF, account isolation, and sign-out.
  CI runs them against a production build.
- `pnpm seed:demo` creates a local demo account with sample roles and actions.
- `pnpm converter:verify:image` checks the converter image inside its sandbox,
  and CI runs it.
- A **Processing issues** link in the sidebar while a save has failed, with a
  count.
- Roles saved from the extension start their timeline with "Saved from the
  browser extension".
- CONTRIBUTING, SECURITY, and CODE_OF_CONDUCT files, issue and pull request
  templates, and Dependabot updates.

### Changed

- The PDF converter moved from `spikes/mhtml-capture` to `apps/converter`.
- A save that cannot become a PDF shows a plain reason on the role's page and on
  Processing issues. A page with no readable text fails at once instead of being
  retried three times.
- Timeline headings use plain words, such as "Status changed" instead of
  "Manual Correction".
- The worker claims saves with time-limited leases, so a crashed worker cannot
  hold a save forever.

### Fixed

- The sidebar's action count now updates as soon as an action is added or
  edited, not up to 30 seconds later.
- A production build now allows the configured Supabase address in its content
  security policy, so self-hosted Supabase on its own domain works.
- Running pnpm commands inside `apps/web` no longer fails on a leftover
  workspace file.

### Removed

- The Pursue, Maybe, and Pass decision for saved roles, and the pausing of
  actions on passed roles. The database columns remain so no data is lost.

### Security

- Failed saves no longer show the converter command, server paths, or user IDs
  to the person who saved the job. Existing stored errors are replaced.
- Patched transitive `brace-expansion` and `uuid` advisories from `exceljs`.
