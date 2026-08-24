-- pgcrypto is installed in the extensions schema on hosted Supabase projects.
-- Keep the security-definer function's lookup path explicit and non-user-writable.
alter function public.issue_forwarding_address(text)
  set search_path = pg_catalog, extensions;
