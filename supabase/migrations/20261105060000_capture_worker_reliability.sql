-- Capture metadata controls service-role storage operations. The extension
-- already creates and updates it through the capture RPCs.
revoke insert, update, delete on public.documents from public, anon, authenticated;
drop policy documents_insert_own on public.documents;
drop policy documents_update_own on public.documents;
drop policy documents_delete_own on public.documents;

-- Keep retired object keys until Storage confirms deletion. This queue also
-- survives a role being deleted while its retired files are still pending.
create table public.capture_storage_deletions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null,
  user_id uuid not null,
  bucket_id text not null check (bucket_id in ('temporary-captures', 'job-descriptions')),
  storage_path text not null,
  available_at timestamptz not null default now(),
  unique (document_id, bucket_id, storage_path)
);

create index capture_storage_deletions_available_idx
  on public.capture_storage_deletions (available_at, id);
alter table public.capture_storage_deletions enable row level security;
revoke all on public.capture_storage_deletions from public, anon, authenticated;
grant select, update, delete on public.capture_storage_deletions to service_role;

create function public.queue_expired_capture_payloads(p_failed_before timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_retired integer;
begin
  -- The replay and upload RPCs lock the same job before reading its path.
  -- Detach the key in that transaction so it can never be replayed after
  -- entering the deletion queue.
  with candidates as (
    select d.id, d.temporary_storage_path
    from public.capture_jobs j
    join public.documents d on d.id = j.document_id and d.user_id = j.user_id
    where j.status = 'FAILED'
      and j.failed_at < p_failed_before
      and j.updated_at < now() - interval '30 minutes'
      and d.temporary_storage_path is not null
    order by j.failed_at, j.id
    limit 20
    for update of j skip locked
  ), retired as (
    update public.documents d
    set temporary_storage_path = null
    from candidates c
    where d.id = c.id and d.temporary_storage_path = c.temporary_storage_path
    returning d.id, d.user_id, c.temporary_storage_path
  )
  insert into public.capture_storage_deletions (document_id, user_id, bucket_id, storage_path)
  select id, user_id, 'temporary-captures', temporary_storage_path
  from retired
  on conflict (document_id, bucket_id, storage_path) do nothing;

  get diagnostics v_retired = row_count;
  return v_retired;
end;
$$;

revoke all on function public.queue_expired_capture_payloads(timestamptz)
  from public, anon, authenticated;
grant execute on function public.queue_expired_capture_payloads(timestamptz) to service_role;

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

  select j.id into v_job_id
  from public.capture_jobs j
  where j.document_id = p_document_id and j.user_id = v_user_id and j.status = 'FAILED'
  for update;

  if not found then
    return false;
  end if;

  -- Read the document after taking the job lock. Retention may have detached
  -- the path while replay was waiting for that lock.
  select d.temporary_storage_path into v_temporary_storage_path
  from public.documents d
  where d.id = p_document_id and d.user_id = v_user_id;

  if v_temporary_storage_path is null or not exists (
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
  where id = v_job_id;

  update public.documents
  set capture_status = 'PENDING', file_size_bytes = null, checksum_sha256 = null
  where id = p_document_id;

  return true;
end;
$$;

create or replace function public.retry_capture_upload(p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_job public.capture_jobs%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select * into v_job from public.capture_jobs
  where id = p_job_id and user_id = v_user_id
  for update;

  if not found or (
    v_job.status <> 'FAILED' and (v_job.status <> 'PENDING' or v_job.available_at is not null)
  ) then
    return false;
  end if;

  if not exists (
    select 1 from public.documents
    where id = v_job.document_id and user_id = v_user_id and temporary_storage_path is not null
  ) then
    raise exception 'The temporary capture expired. Save the page again to start a new upload.';
  end if;

  update public.capture_jobs
  set status = 'PENDING', available_at = null, completed_at = null,
      last_error = null, attempt_count = 0
  where id = v_job.id;

  if v_job.status = 'FAILED' then
    update public.documents
    set capture_status = 'PENDING', file_size_bytes = null, checksum_sha256 = null
    where id = v_job.document_id;
  end if;

  return true;
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
  where id = p_job_id and status in ('PROCESSING', 'COMPLETE')
  for update;

  if not found then
    return false;
  end if;

  -- A client may retry after the first transaction committed and its response
  -- was lost. Confirm the same result without adding a second timeline event.
  if v_job.status = 'COMPLETE' then
    return exists (
      select 1 from public.documents
      where id = v_job.document_id and capture_status = 'COMPLETE'
        and file_size_bytes = p_file_size_bytes and checksum_sha256 = p_checksum_sha256
    );
  end if;

  select status into v_application_status
  from public.applications where id = v_job.application_id;

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

create or replace function public.purge_expired_operational_data(
  p_failed_metadata_retention_days integer default 90
)
returns table (capture_jobs_deleted bigint)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_failed_metadata_retention_days not between 30 and 3650 then
    raise exception 'Failed-job metadata retention must be between 30 and 3650 days';
  end if;

  return query
  with deleted_jobs as (
    delete from public.capture_jobs j
    where j.status = 'FAILED'
      and j.failed_at < now() - make_interval(days => p_failed_metadata_retention_days)
      and j.updated_at < now() - interval '30 minutes'
      and exists (
        select 1 from public.documents d where d.id = j.document_id and d.temporary_storage_path is null
      )
      and not exists (
        select 1 from public.capture_storage_deletions q
        where q.document_id = j.document_id and q.bucket_id = 'temporary-captures'
      )
    returning j.document_id
  ), deleted_documents as (
    delete from public.documents d
    using deleted_jobs j
    where d.id = j.document_id and d.capture_status = 'FAILED' and d.temporary_storage_path is null
    returning d.id, d.user_id, d.storage_path
  ), queued_outputs as (
    -- A conversion may have uploaded a PDF before failing to commit. Keep it
    -- through retries and retire it with the failed document.
    insert into public.capture_storage_deletions (document_id, user_id, bucket_id, storage_path)
    select d.id, d.user_id, 'job-descriptions', d.storage_path
    from deleted_documents d
    where exists (
      select 1 from storage.objects s where s.bucket_id = 'job-descriptions' and s.name = d.storage_path
    )
    on conflict (document_id, bucket_id, storage_path) do nothing
  )
  select count(*) from deleted_jobs;
end;
$$;

create or replace function public.create_capture_session(
  p_company text,
  p_position text,
  p_original_url text,
  p_captured_at timestamptz,
  p_idempotency_key uuid,
  p_job_id text default null
)
returns table (
  job_id uuid,
  application_id uuid,
  document_id uuid,
  temporary_storage_path text,
  output_storage_path text,
  capture_status public.capture_status,
  application_reused boolean,
  application_company text,
  application_position text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_job_id uuid;
  v_job_status public.capture_status;
  v_application_id uuid;
  v_document_id uuid;
  v_temporary_storage_path text;
  v_output_storage_path text;
  v_identity_key text;
  v_reused boolean := false;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  p_company := trim(p_company);
  p_position := trim(p_position);
  p_original_url := trim(p_original_url);
  p_job_id := nullif(trim(coalesce(p_job_id, '')), '');

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
  if p_job_id is not null and char_length(p_job_id) > 100 then
    raise exception 'Job ID must contain at most 100 characters';
  end if;

  v_identity_key := public.application_identity_key(p_original_url, p_company, p_job_id);

  -- Serialize all captures of the same posting, even when separate popup
  -- sessions generated different idempotency keys.
  perform pg_advisory_xact_lock(hashtextextended(
    v_user_id::text || ':' || coalesce(v_identity_key, p_idempotency_key::text), 0
  ));

  select j.id, j.application_id, j.document_id, j.status
  into v_job_id, v_application_id, v_document_id, v_job_status
  from public.capture_jobs j
  where j.user_id = v_user_id and j.idempotency_key = p_idempotency_key
  for update;

  if v_job_id is null then
    v_application_id := public.find_matching_application(v_user_id, p_original_url, p_company, p_job_id);

    if v_application_id is not null then
      v_reused := true;

      perform 1
      from public.applications
      where applications.id = v_application_id
      for update;

      -- Prefer a completed capture; otherwise return the latest recoverable
      -- session. The extension knows how to resume PENDING/FAILED sessions.
      select j.id, j.document_id, j.status
      into v_job_id, v_document_id, v_job_status
      from public.capture_jobs j
      where j.application_id = v_application_id and j.user_id = v_user_id
      order by
        case j.status when 'COMPLETE' then 0 when 'PROCESSING' then 1 when 'PENDING' then 2 else 3 end,
        j.created_at desc
      limit 1
      for update;
    else
      v_application_id := gen_random_uuid();

      insert into public.applications (
        id, user_id, company, company_normalized, position, position_normalized,
        status, source, original_url, job_id
      ) values (
        v_application_id, v_user_id, p_company, '', p_position, '',
        'SAVED', 'EXTENSION', p_original_url, p_job_id
      );
    end if;
  end if;

  if v_job_id is null then
    -- A reused manual application may not have a saved job description yet.
    -- Attach its first capture directly to that existing application.
    v_job_id := gen_random_uuid();
    v_document_id := gen_random_uuid();
    v_temporary_storage_path :=
      v_user_id::text || '/' || v_application_id::text || '/' || v_document_id::text || '.mhtml';
    v_output_storage_path :=
      v_user_id::text || '/' || v_application_id::text || '/job-description-' || v_document_id::text || '.pdf';
    v_job_status := 'PENDING';

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
  else
    select d.temporary_storage_path, d.storage_path
    into v_temporary_storage_path, v_output_storage_path
    from public.documents d
    where d.id = v_document_id and d.user_id = v_user_id;

    if v_job_status = 'FAILED' then
      if v_temporary_storage_path is null then
        -- The old key may still be awaiting deletion. A recapture gets a new key.
        v_temporary_storage_path := v_user_id::text || '/' || v_application_id::text || '/'
          || v_document_id::text || '-' || gen_random_uuid()::text || '.mhtml';

        update public.documents
        set temporary_storage_path = v_temporary_storage_path
        where documents.id = v_document_id and documents.user_id = v_user_id;
      end if;

      -- Give the client the usual upload window to prepare its returned key.
      update public.capture_jobs set updated_at = now() where id = v_job_id;
    end if;
  end if;

  return query
  select
    v_job_id, v_application_id, v_document_id,
    v_temporary_storage_path, v_output_storage_path,
    v_job_status, v_reused,
    applications.company, applications.position
  from public.applications
  where applications.id = v_application_id;
end;
$$;
