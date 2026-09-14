alter table public.inbound_email_jobs
  add column storage_deleted_at timestamptz;

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
  where id in (
    select document_id from public.capture_jobs
    where status = 'PROCESSING'
      and updated_at < now() - interval '15 minutes'
      and attempt_count >= 3
  );

  update public.capture_jobs
  set status = 'FAILED',
      available_at = null,
      last_error = 'Processing lease expired after the maximum number of attempts'
  where status = 'PROCESSING'
    and updated_at < now() - interval '15 minutes'
    and attempt_count >= 3;

  update public.documents
  set capture_status = 'PENDING'
  where id in (
    select document_id from public.capture_jobs
    where status = 'PROCESSING'
      and updated_at < now() - interval '15 minutes'
      and attempt_count < 3
  );

  update public.capture_jobs
  set status = 'PENDING',
      available_at = now(),
      last_error = 'Processing lease expired; retry queued'
  where status = 'PROCESSING'
    and updated_at < now() - interval '15 minutes'
    and attempt_count < 3;

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
  where id = v_job_id;

  update public.documents
  set capture_status = 'PROCESSING'
  where id = (select capture_jobs.document_id from public.capture_jobs where capture_jobs.id = v_job_id);

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

create or replace function public.complete_capture_job(
  p_job_id uuid,
  p_file_size_bytes bigint,
  p_checksum_sha256 text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.capture_jobs%rowtype;
  v_application_status public.application_status;
begin
  select * into v_job from public.capture_jobs
  where id = p_job_id and status = 'PROCESSING'
  for update;

  if v_job.id is null then
    return false;
  end if;

  select status into v_application_status
  from public.applications
  where id = v_job.application_id;

  update public.documents
  set capture_status = 'COMPLETE',
      file_size_bytes = p_file_size_bytes,
      checksum_sha256 = p_checksum_sha256
  where id = v_job.document_id;

  update public.capture_jobs
  set status = 'COMPLETE', completed_at = now(), last_error = null
  where id = v_job.id;

  insert into public.application_events (
    application_id, user_id, event_type, event_time, source, evidence,
    previous_status, new_status
  ) values (
    v_job.application_id, v_job.user_id, 'JD_SAVED', now(), 'SYSTEM',
    'Job description captured as PDF', v_application_status, v_application_status
  );

  return true;
end;
$$;

create or replace function public.fail_capture_job(p_job_id uuid, p_error text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.capture_jobs%rowtype;
begin
  select * into v_job
  from public.capture_jobs
  where id = p_job_id and status = 'PROCESSING'
  for update;

  if v_job.id is null then
    return false;
  end if;

  if v_job.attempt_count < 3 then
    update public.capture_jobs
    set status = 'PENDING',
        available_at = now() + case v_job.attempt_count
          when 1 then interval '5 seconds'
          when 2 then interval '30 seconds'
          else interval '5 minutes'
        end,
        last_error = left(coalesce(p_error, 'Capture failed'), 2000)
    where id = v_job.id;

    update public.documents
    set capture_status = 'PENDING'
    where id = v_job.document_id;
  else
    update public.capture_jobs
    set status = 'FAILED',
        available_at = null,
        last_error = left(coalesce(p_error, 'Capture failed'), 2000)
    where id = v_job.id;

    update public.documents
    set capture_status = 'FAILED'
    where id = v_job.document_id;
  end if;

  return true;
end;
$$;

create or replace function public.retry_failed_capture(p_document_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_job_id uuid;
  v_temporary_storage_path text;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select capture_jobs.id, documents.temporary_storage_path
  into v_job_id, v_temporary_storage_path
  from public.capture_jobs
  join public.documents on documents.id = capture_jobs.document_id
  where capture_jobs.document_id = p_document_id
    and capture_jobs.user_id = v_user_id
    and capture_jobs.status = 'FAILED'
  for update of capture_jobs;

  if v_job_id is null or v_temporary_storage_path is null then
    return false;
  end if;

  if not exists (
    select 1 from storage.objects
    where bucket_id = 'temporary-captures'
      and name = v_temporary_storage_path
      and owner_id = v_user_id::text
  ) then
    return false;
  end if;

  update public.capture_jobs
  set status = 'PENDING', available_at = now(), completed_at = null,
      last_error = null, attempt_count = 0
  where id = v_job_id and user_id = v_user_id;

  update public.documents
  set capture_status = 'PENDING', file_size_bytes = null, checksum_sha256 = null
  where id = p_document_id and user_id = v_user_id;

  return true;
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
  set status = case when attempt_count >= 3 then 'FAILED' else 'PENDING' end,
      available_at = case when attempt_count >= 3 then null else now() end,
      last_error = case
        when attempt_count >= 3 then 'Processing lease expired after the maximum number of attempts'
        else 'Processing lease expired; retry queued'
      end
  where status = 'PROCESSING'
    and updated_at < now() - interval '15 minutes';

  select inbound_email_jobs.id into v_job_id
  from public.inbound_email_jobs
  where status = 'PENDING'
    and available_at is not null
    and available_at <= now()
  order by available_at, created_at
  for update skip locked
  limit 1;

  if v_job_id is null then
    return;
  end if;

  update public.inbound_email_jobs
  set status = 'PROCESSING', attempt_count = attempt_count + 1, last_error = null
  where id = v_job_id;

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
  select attempt_count into v_attempt_count
  from public.inbound_email_jobs
  where id = p_job_id and status = 'PROCESSING'
  for update;

  if v_attempt_count is null then
    return false;
  end if;

  update public.inbound_email_jobs
  set status = case when v_attempt_count >= 3 then 'FAILED' else 'PENDING' end,
      available_at = case
        when v_attempt_count >= 3 then null
        when v_attempt_count = 1 then now() + interval '5 seconds'
        when v_attempt_count = 2 then now() + interval '30 seconds'
        else now() + interval '5 minutes'
      end,
      last_error = left(coalesce(p_error, 'Email processing failed'), 2000)
  where id = p_job_id;

  return true;
end;
$$;
