-- Recover captures that used to get stuck, and tell the extension which
-- application a save really landed on.
--
-- 1. A save that dies before finalizing its upload stayed PENDING forever: the
--    worker never claims it, the dashboard said it was waiting for the worker,
--    and nothing cleaned up its file. Such saves now fail after 30 minutes, so
--    they get a retry button and the normal failed-capture retention.
-- 2. A failed capture whose file had expired could not be captured again,
--    because its session came back without a storage path.
-- 3. A save that reuses an application now returns that application's company
--    and position, so the extension can show what was really saved.

-- ---------------------------------------------------------------------------
-- Abandoned uploads
-- ---------------------------------------------------------------------------

create function public.expire_abandoned_capture_uploads()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expired integer;
begin
  with expired_jobs as (
    update public.capture_jobs
    set status = 'FAILED',
        last_error = 'The upload did not finish. Save the job again from its page.'
    where status = 'PENDING'
      and available_at is null
      and updated_at < now() - interval '30 minutes'
    returning document_id
  ), expired_documents as (
    update public.documents
    set capture_status = 'FAILED'
    where id in (select document_id from expired_jobs)
    returning id
  )
  select count(*) into v_expired from expired_jobs;

  return v_expired;
end;
$$;

revoke all on function public.expire_abandoned_capture_uploads() from public, anon, authenticated;
grant execute on function public.expire_abandoned_capture_uploads() to service_role;

-- Starting another attempt restarts the 30 minutes, so a retry of an old upload
-- cannot be expired while it is running.
create or replace function public.retry_capture_upload(p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_document_id uuid;
  v_status public.capture_status;
  v_available_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select document_id, status, available_at
  into v_document_id, v_status, v_available_at
  from public.capture_jobs
  where id = p_job_id and user_id = v_user_id
  for update;

  if v_document_id is null then
    return false;
  end if;

  if v_status = 'PENDING' and v_available_at is null then
    update public.capture_jobs
    set updated_at = now()
    where id = p_job_id and user_id = v_user_id;
    return true;
  end if;

  if v_status <> 'FAILED' then
    return false;
  end if;

  update public.capture_jobs
  set status = 'PENDING', available_at = null, completed_at = null, last_error = null
  where id = p_job_id and user_id = v_user_id;

  update public.documents
  set capture_status = 'PENDING', file_size_bytes = null, checksum_sha256 = null
  where id = v_document_id and user_id = v_user_id;

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Capture session
-- ---------------------------------------------------------------------------

drop function public.create_capture_session(text, text, text, timestamptz, uuid, text);

create function public.create_capture_session(
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

  if v_job_id is null then
    if v_identity_key is not null then
      select applications.id into v_application_id
      from public.applications
      where applications.user_id = v_user_id
        and applications.identity_key = v_identity_key
      for update;
    end if;

    if v_application_id is not null then
      v_reused := true;

      -- Prefer a completed capture; otherwise return the latest recoverable
      -- session. The extension knows how to resume PENDING/FAILED sessions.
      select
        capture_jobs.id,
        capture_jobs.document_id,
        documents.temporary_storage_path,
        documents.storage_path
      into
        v_job_id,
        v_document_id,
        v_temporary_storage_path,
        v_output_storage_path
      from public.capture_jobs
      join public.documents on documents.id = capture_jobs.document_id
      where capture_jobs.application_id = v_application_id
        and capture_jobs.user_id = v_user_id
      order by
        case capture_jobs.status when 'COMPLETE' then 0 when 'PROCESSING' then 1 when 'PENDING' then 2 else 3 end,
        capture_jobs.created_at desc
      limit 1;
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
    select capture_jobs.status into v_job_status
    from public.capture_jobs
    where capture_jobs.id = v_job_id;

    -- Retention clears the path of a failed capture once its file expires. The
    -- user can still capture the page again, so give the session its path back.
    if v_job_status = 'FAILED' and v_temporary_storage_path is null then
      v_temporary_storage_path :=
        v_user_id::text || '/' || v_application_id::text || '/' || v_document_id::text || '.mhtml';

      update public.documents
      set temporary_storage_path = v_temporary_storage_path
      where documents.id = v_document_id and documents.user_id = v_user_id;
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

revoke all on function public.create_capture_session(text, text, text, timestamptz, uuid, text) from public;
grant execute on function public.create_capture_session(text, text, text, timestamptz, uuid, text) to authenticated;
