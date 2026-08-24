create table public.capture_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  idempotency_key uuid not null,
  status public.capture_status not null default 'PENDING',
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key),
  unique (document_id)
);

create index capture_jobs_ready_idx
  on public.capture_jobs(status, available_at, created_at)
  where status = 'PENDING' and available_at is not null;

create trigger capture_jobs_set_updated_at
before update on public.capture_jobs
for each row execute function public.set_updated_at();

alter table public.capture_jobs enable row level security;

create policy capture_jobs_select_own on public.capture_jobs
for select to authenticated using ((select auth.uid()) = user_id);

grant select on public.capture_jobs to authenticated;

create function public.create_capture_session(
  p_company text,
  p_position text,
  p_original_url text,
  p_captured_at timestamptz,
  p_idempotency_key uuid
)
returns table (
  job_id uuid,
  application_id uuid,
  document_id uuid,
  temporary_storage_path text,
  output_storage_path text,
  capture_status public.capture_status
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_job_id uuid;
  v_application_id uuid;
  v_document_id uuid;
  v_temporary_storage_path text;
  v_output_storage_path text;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  p_company := trim(p_company);
  p_position := trim(p_position);
  p_original_url := trim(p_original_url);

  if char_length(p_company) not between 1 and 200 then
    raise exception 'Company must contain 1 to 200 characters';
  end if;
  if char_length(p_position) not between 1 and 300 then
    raise exception 'Position must contain 1 to 300 characters';
  end if;
  if p_original_url !~* '^https?://' then
    raise exception 'Original URL must use HTTP or HTTPS';
  end if;
  if p_captured_at is null then
    raise exception 'Capture time is required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_user_id::text || ':' || p_idempotency_key::text, 0)
  );

  select
    capture_jobs.id,
    capture_jobs.application_id,
    capture_jobs.document_id,
    documents.temporary_storage_path,
    documents.storage_path
  into
    v_job_id,
    v_application_id,
    v_document_id,
    v_temporary_storage_path,
    v_output_storage_path
  from public.capture_jobs
  join public.documents on documents.id = capture_jobs.document_id
  where capture_jobs.user_id = v_user_id
    and capture_jobs.idempotency_key = p_idempotency_key;

  if v_job_id is not null then
    return query select
      v_job_id,
      v_application_id,
      v_document_id,
      v_temporary_storage_path,
      v_output_storage_path,
      (select status from public.capture_jobs where id = v_job_id);
    return;
  end if;

  v_job_id := gen_random_uuid();
  v_application_id := gen_random_uuid();
  v_document_id := gen_random_uuid();
  v_temporary_storage_path :=
    v_user_id::text || '/' || v_application_id::text || '/' || v_document_id::text || '.mhtml';
  v_output_storage_path :=
    v_user_id::text || '/' || v_application_id::text || '/job-description-' || v_document_id::text || '.pdf';

  insert into public.applications (
    id, user_id, company, company_normalized, position, position_normalized,
    status, source, original_url
  ) values (
    v_application_id, v_user_id, p_company, lower(p_company), p_position, lower(p_position),
    'SAVED', 'EXTENSION', p_original_url
  );

  insert into public.documents (
    id, application_id, user_id, storage_path, temporary_storage_path,
    original_url, capture_status, captured_at
  ) values (
    v_document_id, v_application_id, v_user_id, v_output_storage_path,
    v_temporary_storage_path, p_original_url, 'PENDING', p_captured_at
  );

  insert into public.capture_jobs (
    id, user_id, application_id, document_id, idempotency_key, status
  ) values (
    v_job_id, v_user_id, v_application_id, v_document_id, p_idempotency_key, 'PENDING'
  );

  return query select
    v_job_id,
    v_application_id,
    v_document_id,
    v_temporary_storage_path,
    v_output_storage_path,
    'PENDING'::public.capture_status;
end;
$$;

create function public.finalize_capture_upload(p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_temporary_storage_path text;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select documents.temporary_storage_path
  into v_temporary_storage_path
  from public.capture_jobs
  join public.documents on documents.id = capture_jobs.document_id
  where capture_jobs.id = p_job_id
    and capture_jobs.user_id = v_user_id
    and capture_jobs.status = 'PENDING';

  if v_temporary_storage_path is null then
    return false;
  end if;

  if not exists (
    select 1 from storage.objects
    where bucket_id = 'temporary-captures'
      and name = v_temporary_storage_path
      and owner_id = v_user_id::text
  ) then
    raise exception 'Temporary capture upload was not found';
  end if;

  update public.capture_jobs
  set available_at = now(), last_error = null
  where id = p_job_id and user_id = v_user_id and status = 'PENDING';

  return found;
end;
$$;

create function public.fail_capture_upload(p_job_id uuid, p_error text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_document_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select document_id into v_document_id
  from public.capture_jobs
  where id = p_job_id and user_id = v_user_id and status = 'PENDING';

  if v_document_id is null then
    return false;
  end if;

  update public.capture_jobs
  set status = 'FAILED', last_error = left(coalesce(p_error, 'Upload failed'), 2000)
  where id = p_job_id and user_id = v_user_id and status = 'PENDING';

  update public.documents
  set capture_status = 'FAILED'
  where id = v_document_id and user_id = v_user_id;

  return true;
end;
$$;

create function public.claim_capture_job()
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
  select capture_jobs.id
  into v_job_id
  from public.capture_jobs
  where capture_jobs.status = 'PENDING'
    and capture_jobs.available_at is not null
  order by capture_jobs.created_at
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

create function public.complete_capture_job(
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
begin
  select * into v_job from public.capture_jobs
  where id = p_job_id and status = 'PROCESSING'
  for update;

  if v_job.id is null then
    return false;
  end if;

  update public.documents
  set capture_status = 'COMPLETE',
      file_size_bytes = p_file_size_bytes,
      checksum_sha256 = p_checksum_sha256,
      temporary_storage_path = null
  where id = v_job.document_id;

  update public.capture_jobs
  set status = 'COMPLETE', completed_at = now(), last_error = null
  where id = v_job.id;

  insert into public.application_events (
    application_id, user_id, event_type, event_time, source, evidence,
    previous_status, new_status
  ) values (
    v_job.application_id, v_job.user_id, 'JD_SAVED', now(), 'SYSTEM',
    'Job description captured as PDF', 'SAVED', 'SAVED'
  );

  return true;
end;
$$;

create function public.fail_capture_job(p_job_id uuid, p_error text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document_id uuid;
begin
  select document_id into v_document_id
  from public.capture_jobs
  where id = p_job_id and status = 'PROCESSING'
  for update;

  if v_document_id is null then
    return false;
  end if;

  update public.documents set capture_status = 'FAILED' where id = v_document_id;
  update public.capture_jobs
  set status = 'FAILED', last_error = left(coalesce(p_error, 'Capture failed'), 2000)
  where id = p_job_id;

  return true;
end;
$$;

revoke all on function public.create_capture_session(text, text, text, timestamptz, uuid) from public;
revoke all on function public.finalize_capture_upload(uuid) from public;
revoke all on function public.fail_capture_upload(uuid, text) from public;
revoke all on function public.claim_capture_job() from public;
revoke all on function public.complete_capture_job(uuid, bigint, text) from public;
revoke all on function public.fail_capture_job(uuid, text) from public;

grant execute on function public.create_capture_session(text, text, text, timestamptz, uuid) to authenticated;
grant execute on function public.finalize_capture_upload(uuid) to authenticated;
grant execute on function public.fail_capture_upload(uuid, text) to authenticated;
grant execute on function public.claim_capture_job() to service_role;
grant execute on function public.complete_capture_job(uuid, bigint, text) to service_role;
grant execute on function public.fail_capture_job(uuid, text) to service_role;
