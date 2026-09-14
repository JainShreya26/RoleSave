create or replace function public.purge_expired_operational_data(
  p_failed_metadata_retention_days integer default 90,
  p_rate_limit_retention_days integer default 2
)
returns table (
  capture_jobs_deleted bigint,
  email_jobs_deleted bigint,
  rate_limit_rows_deleted bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_capture_jobs_deleted bigint;
  v_email_jobs_deleted bigint;
  v_rate_limit_rows_deleted bigint;
begin
  if p_failed_metadata_retention_days not between 30 and 3650 then
    raise exception 'Failed-job metadata retention must be between 30 and 3650 days';
  end if;
  if p_rate_limit_retention_days not between 1 and 30 then
    raise exception 'Rate-limit retention must be between 1 and 30 days';
  end if;

  with deleted_jobs as (
    delete from public.capture_jobs
    where capture_jobs.status = 'FAILED'
      and capture_jobs.failed_at < now() - make_interval(days => p_failed_metadata_retention_days)
      and exists (
        select 1 from public.documents
        where documents.id = capture_jobs.document_id
          and documents.temporary_storage_path is null
      )
    returning capture_jobs.document_id
  ), deleted_documents as (
    delete from public.documents
    using deleted_jobs
    where documents.id = deleted_jobs.document_id
      and documents.capture_status = 'FAILED'
      and documents.temporary_storage_path is null
    returning documents.id
  )
  select count(*) into v_capture_jobs_deleted from deleted_jobs;

  delete from public.inbound_email_jobs
  where inbound_email_jobs.status = 'FAILED'
    and inbound_email_jobs.failed_at < now() - make_interval(days => p_failed_metadata_retention_days)
    and inbound_email_jobs.storage_deleted_at is not null;
  get diagnostics v_email_jobs_deleted = row_count;

  delete from public.webhook_rate_limits
  where webhook_rate_limits.window_start < now() - make_interval(days => p_rate_limit_retention_days);
  get diagnostics v_rate_limit_rows_deleted = row_count;

  return query select
    v_capture_jobs_deleted,
    v_email_jobs_deleted,
    v_rate_limit_rows_deleted;
end;
$$;

revoke execute on function public.purge_expired_operational_data(integer, integer)
  from public, anon, authenticated;
grant execute on function public.purge_expired_operational_data(integer, integer)
  to service_role;
