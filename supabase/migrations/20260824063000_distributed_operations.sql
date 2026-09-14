alter table public.capture_jobs
  add column failed_at timestamptz;

alter table public.inbound_email_jobs
  add column failed_at timestamptz;

update public.capture_jobs
set failed_at = updated_at
where status = 'FAILED' and failed_at is null;

update public.inbound_email_jobs
set failed_at = updated_at
where status = 'FAILED' and failed_at is null;

create or replace function public.set_job_failed_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status::text = 'FAILED' then
    if tg_op = 'INSERT' or old.status::text <> 'FAILED' then
      new.failed_at := coalesce(new.failed_at, now());
    end if;
  else
    new.failed_at := null;
  end if;
  return new;
end;
$$;

create trigger capture_jobs_set_failed_at
before insert or update of status on public.capture_jobs
for each row execute function public.set_job_failed_at();

create trigger inbound_email_jobs_set_failed_at
before insert or update of status on public.inbound_email_jobs
for each row execute function public.set_job_failed_at();

create index capture_jobs_failed_retention_idx
  on public.capture_jobs(failed_at)
  where status = 'FAILED';

create index inbound_email_jobs_failed_retention_idx
  on public.inbound_email_jobs(failed_at)
  where status = 'FAILED';

create policy inbound_email_jobs_select_own on public.inbound_email_jobs
for select to authenticated using ((select auth.uid()) = user_id);

grant select on public.inbound_email_jobs to authenticated;

create or replace function public.retry_failed_email_job(p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_storage_path text;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select inbound_email_jobs.storage_path
  into v_storage_path
  from public.inbound_email_jobs
  where inbound_email_jobs.id = p_job_id
    and inbound_email_jobs.user_id = v_user_id
    and inbound_email_jobs.status = 'FAILED'
    and inbound_email_jobs.storage_deleted_at is null
  for update;

  if v_storage_path is null then
    return false;
  end if;

  if not exists (
    select 1 from storage.objects
    where storage.objects.bucket_id = 'inbound-emails'
      and storage.objects.name = v_storage_path
  ) then
    return false;
  end if;

  update public.inbound_email_jobs
  set status = 'PENDING',
      available_at = now(),
      attempt_count = 0,
      completed_at = null,
      last_error = null
  where inbound_email_jobs.id = p_job_id
    and inbound_email_jobs.user_id = v_user_id;

  return true;
end;
$$;

revoke all on function public.retry_failed_email_job(uuid) from public;
grant execute on function public.retry_failed_email_job(uuid) to authenticated;

create table public.webhook_rate_limits (
  scope_key text not null check (char_length(scope_key) between 1 and 200),
  window_start timestamptz not null,
  request_count integer not null default 1 check (request_count > 0),
  updated_at timestamptz not null default now(),
  primary key (scope_key, window_start)
);

alter table public.webhook_rate_limits enable row level security;
revoke all on public.webhook_rate_limits from public, anon, authenticated;

create or replace function public.consume_webhook_rate_limit(
  p_scope_key text,
  p_maximum_requests integer,
  p_window_seconds integer
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window_start timestamptz;
  v_count integer;
begin
  p_scope_key := trim(p_scope_key);
  if char_length(p_scope_key) not between 1 and 200 then
    raise exception 'Rate-limit scope key is invalid';
  end if;
  if p_maximum_requests not between 1 and 100000 then
    raise exception 'Rate-limit maximum is invalid';
  end if;
  if p_window_seconds not between 1 and 86400 then
    raise exception 'Rate-limit window is invalid';
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds
  );

  insert into public.webhook_rate_limits (scope_key, window_start)
  values (p_scope_key, v_window_start)
  on conflict (scope_key, window_start) do update
    set request_count = public.webhook_rate_limits.request_count + 1,
        updated_at = v_now
  returning request_count into v_count;

  return query select
    v_count <= p_maximum_requests,
    case
      when v_count <= p_maximum_requests then 0
      else greatest(
        1,
        ceil(extract(epoch from (v_window_start + make_interval(secs => p_window_seconds) - v_now)))::integer
      )
    end;
end;
$$;

revoke all on function public.consume_webhook_rate_limit(text, integer, integer) from public;
grant execute on function public.consume_webhook_rate_limit(text, integer, integer) to service_role;

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

  delete from public.capture_jobs
  where capture_jobs.status = 'FAILED'
    and capture_jobs.failed_at < now() - make_interval(days => p_failed_metadata_retention_days)
    and exists (
      select 1 from public.documents
      where documents.id = capture_jobs.document_id
        and documents.temporary_storage_path is null
    );
  get diagnostics v_capture_jobs_deleted = row_count;

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

revoke all on function public.purge_expired_operational_data(integer, integer) from public;
grant execute on function public.purge_expired_operational_data(integer, integer) to service_role;
