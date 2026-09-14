-- The backend uses the service-role client for a few direct reads and writes.
-- RLS bypass does not replace PostgreSQL table privileges in a fresh project.
-- Keep these grants scoped to the operations used by the worker and server.

grant select on public.applications,
  public.documents,
  public.capture_jobs,
  public.inbound_email_jobs,
  public.email_events
to service_role;

grant insert on public.capture_jobs,
  public.inbound_email_jobs
to service_role;

grant update on public.documents,
  public.inbound_email_jobs,
  public.email_events
to service_role;
