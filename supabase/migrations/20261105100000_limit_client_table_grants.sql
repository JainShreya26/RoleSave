-- Supabase's legacy default grants also include table-level operations such as
-- TRUNCATE. Row-level security only controls operations that access rows.
revoke all privileges on table
  public.applications,
  public.application_events,
  public.documents,
  public.capture_jobs,
  public.application_actions,
  public.application_attachments,
  public.capture_storage_deletions
from public, anon, authenticated;

grant select, insert, update, delete on table
  public.applications, public.application_actions to authenticated;
grant select, insert on table public.application_events to authenticated;
grant select, insert, delete on table public.application_attachments to authenticated;
grant select on table public.documents, public.capture_jobs to authenticated;

-- Require explicit access for future tables created by the migration role.
alter default privileges in schema public
  revoke all privileges on tables from public, anon, authenticated;
