create or replace function public.claim_capture_job()
returns table (
  job_id uuid,
  application_id uuid,
  document_id uuid,
  user_id uuid,
  temporary_storage_path text,
  output_storage_path text,
  company text,
  job_position text,
  original_url text,
  captured_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_id uuid;
begin
  update public.documents
  set capture_status = 'FAILED'
  where documents.id in (
    select capture_jobs.document_id from public.capture_jobs
    where capture_jobs.status = 'PROCESSING'
      and capture_jobs.updated_at < now() - interval '15 minutes'
      and capture_jobs.attempt_count >= 3
  );

  update public.capture_jobs
  set status = 'FAILED',
      available_at = null,
      last_error = 'Processing lease expired after the maximum number of attempts'
  where capture_jobs.status = 'PROCESSING'
    and capture_jobs.updated_at < now() - interval '15 minutes'
    and capture_jobs.attempt_count >= 3;

  update public.documents
  set capture_status = 'PENDING'
  where documents.id in (
    select capture_jobs.document_id from public.capture_jobs
    where capture_jobs.status = 'PROCESSING'
      and capture_jobs.updated_at < now() - interval '15 minutes'
      and capture_jobs.attempt_count < 3
  );

  update public.capture_jobs
  set status = 'PENDING',
      available_at = now(),
      last_error = 'Processing lease expired; retry queued'
  where capture_jobs.status = 'PROCESSING'
    and capture_jobs.updated_at < now() - interval '15 minutes'
    and capture_jobs.attempt_count < 3;

  select capture_jobs.id
  into v_job_id
  from public.capture_jobs
  where capture_jobs.status = 'PENDING'
    and capture_jobs.available_at is not null
    and capture_jobs.available_at <= now()
  order by capture_jobs.available_at, capture_jobs.created_at
  for update skip locked
  limit 1;

  if v_job_id is null then
    return;
  end if;

  update public.capture_jobs
  set status = 'PROCESSING', attempt_count = attempt_count + 1, last_error = null
  where capture_jobs.id = v_job_id;

  update public.documents
  set capture_status = 'PROCESSING'
  where documents.id = (
    select capture_jobs.document_id from public.capture_jobs where capture_jobs.id = v_job_id
  );

  return query
  select
    capture_jobs.id,
    capture_jobs.application_id,
    capture_jobs.document_id,
    capture_jobs.user_id,
    documents.temporary_storage_path,
    documents.storage_path,
    applications.company,
    applications.position,
    coalesce(documents.original_url, applications.original_url),
    documents.captured_at
  from public.capture_jobs
  join public.documents on documents.id = capture_jobs.document_id
  join public.applications on applications.id = capture_jobs.application_id
  where capture_jobs.id = v_job_id;
end;
$$;

create or replace function public.claim_inbound_email_job()
returns table (
  job_id uuid,
  user_id uuid,
  email_account_id uuid,
  provider_message_id text,
  storage_path text
)
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_job_id uuid;
begin
  update public.inbound_email_jobs
  set status = case
        when inbound_email_jobs.attempt_count >= 3 then 'FAILED'::public.email_job_status
        else 'PENDING'::public.email_job_status
      end,
      available_at = case when inbound_email_jobs.attempt_count >= 3 then null else now() end,
      last_error = case
        when inbound_email_jobs.attempt_count >= 3
          then 'Processing lease expired after the maximum number of attempts'
        else 'Processing lease expired; retry queued'
      end
  where inbound_email_jobs.status = 'PROCESSING'
    and inbound_email_jobs.updated_at < now() - interval '15 minutes';

  select inbound_email_jobs.id into v_job_id
  from public.inbound_email_jobs
  where inbound_email_jobs.status = 'PENDING'
    and inbound_email_jobs.available_at is not null
    and inbound_email_jobs.available_at <= now()
  order by inbound_email_jobs.available_at, inbound_email_jobs.created_at
  for update skip locked
  limit 1;

  if v_job_id is null then
    return;
  end if;

  update public.inbound_email_jobs
  set status = 'PROCESSING', attempt_count = attempt_count + 1, last_error = null
  where inbound_email_jobs.id = v_job_id;

  return query
  select
    inbound_email_jobs.id,
    inbound_email_jobs.user_id,
    inbound_email_jobs.email_account_id,
    inbound_email_jobs.provider_message_id,
    inbound_email_jobs.storage_path
  from public.inbound_email_jobs
  where inbound_email_jobs.id = v_job_id;
end;
$$;

create or replace function public.fail_inbound_email_job(p_job_id uuid, p_error text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_attempt_count integer;
begin
  select inbound_email_jobs.attempt_count into v_attempt_count
  from public.inbound_email_jobs
  where inbound_email_jobs.id = p_job_id and inbound_email_jobs.status = 'PROCESSING'
  for update;

  if v_attempt_count is null then
    return false;
  end if;

  update public.inbound_email_jobs
  set status = case
        when v_attempt_count >= 3 then 'FAILED'::public.email_job_status
        else 'PENDING'::public.email_job_status
      end,
      available_at = case
        when v_attempt_count >= 3 then null
        when v_attempt_count = 1 then now() + interval '5 seconds'
        when v_attempt_count = 2 then now() + interval '30 seconds'
        else now() + interval '5 minutes'
      end,
      last_error = left(coalesce(p_error, 'Email processing failed'), 2000)
  where inbound_email_jobs.id = p_job_id;

  return true;
end;
$$;
