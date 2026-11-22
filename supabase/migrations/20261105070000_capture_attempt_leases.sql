-- Each claim owns an immutable output key. A delayed upload from a previous
-- claim cannot change the file referenced by a completed document.
alter table public.capture_jobs
  add column attempt_id uuid,
  add column lease_expires_at timestamptz;

create function public._capture_attempt_storage_path(p_user_id uuid, p_document_id uuid, p_attempt_id uuid)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select p_user_id::text || '/capture-attempts/' || p_document_id::text || '/' || p_attempt_id::text || '.pdf';
$$;

revoke all on function public._capture_attempt_storage_path(uuid, uuid, uuid)
  from public, anon, authenticated;

-- Workers with the old protocol must not claim work or publish a shared key
-- after this migration. Existing published documents keep their paths.
drop function public.claim_capture_job();
drop function public.complete_capture_job(uuid, bigint, text);
drop function public.fail_capture_job(uuid, text);

create function public.claim_capture_attempt()
returns table (
  job_id uuid,
  attempt_id uuid,
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
  v_now timestamptz := clock_timestamp();
  v_job public.capture_jobs%rowtype;
begin
  -- Recover expired claims under the same job lock used for completion.
  -- The updated_at fallback applies to work in progress before this migration.
  with expired as (
    select j.id
    from public.capture_jobs j
    where j.status = 'PROCESSING'
      and coalesce(j.lease_expires_at, j.updated_at + interval '15 minutes') <= v_now
    order by j.id
    for update skip locked
  ), released as (
    update public.capture_jobs j
    set status = case when j.attempt_count >= 3 then 'FAILED'::public.capture_status else 'PENDING'::public.capture_status end,
        available_at = case when j.attempt_count < 3 then v_now end,
        last_error = case when j.attempt_count >= 3
          then 'Processing lease expired after the maximum number of attempts'
          else 'Processing lease expired; retry queued'
        end,
        attempt_id = null,
        lease_expires_at = null
    from expired e
    where j.id = e.id
    returning j.document_id, j.user_id, j.status
  )
  update public.documents d
  set capture_status = r.status
  from released r
  where d.id = r.document_id and d.user_id = r.user_id;

  select j.* into v_job
  from public.capture_jobs j
  where j.status = 'PENDING' and j.available_at <= v_now
  order by j.available_at, j.created_at, j.id
  limit 1
  for update skip locked;

  if not found then
    return;
  end if;

  update public.capture_jobs j
  set status = 'PROCESSING', attempt_count = j.attempt_count + 1, last_error = null,
      attempt_id = gen_random_uuid(), lease_expires_at = clock_timestamp() + interval '15 minutes'
  where j.id = v_job.id
  returning j.* into v_job;

  update public.documents d
  set capture_status = 'PROCESSING'
  where d.id = v_job.document_id and d.user_id = v_job.user_id;

  return query
  select v_job.id, v_job.attempt_id, v_job.application_id, v_job.document_id, v_job.user_id,
    d.temporary_storage_path,
    public._capture_attempt_storage_path(v_job.user_id, v_job.document_id, v_job.attempt_id),
    a.company, a.position, coalesce(d.original_url, a.original_url), d.captured_at
  from public.documents d
  join public.applications a on a.id = v_job.application_id and a.user_id = v_job.user_id
  where d.id = v_job.document_id and d.user_id = v_job.user_id;
end;
$$;

create function public.complete_capture_attempt(
  p_job_id uuid,
  p_attempt_id uuid,
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
  v_output_path text;
  v_previous_path text;
  v_application_status public.application_status;
begin
  select * into v_job from public.capture_jobs
  where id = p_job_id and attempt_id = p_attempt_id and status in ('PROCESSING', 'COMPLETE')
  for update;

  if not found then
    return false;
  end if;
  v_output_path := public._capture_attempt_storage_path(v_job.user_id, v_job.document_id, p_attempt_id);

  -- A retry after a lost response confirms the winning attempt and adds no event.
  if v_job.status = 'COMPLETE' then
    return exists (
      select 1 from public.documents
      where id = v_job.document_id and user_id = v_job.user_id
        and capture_status = 'COMPLETE' and storage_path = v_output_path
        and file_size_bytes = p_file_size_bytes and checksum_sha256 = p_checksum_sha256
    );
  end if;

  if v_job.lease_expires_at is null or v_job.lease_expires_at <= clock_timestamp() then
    return false;
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'job-descriptions' and name = v_output_path) then
    return false;
  end if;

  select d.storage_path into v_previous_path from public.documents d
  where d.id = v_job.document_id and d.user_id = v_job.user_id
  for update;
  if not found then
    return false;
  end if;

  select a.status into v_application_status from public.applications a where a.id = v_job.application_id;

  update public.documents
  set capture_status = 'COMPLETE', storage_path = v_output_path,
      file_size_bytes = p_file_size_bytes, checksum_sha256 = p_checksum_sha256
  where id = v_job.document_id;

  update public.capture_jobs
  set status = 'COMPLETE', completed_at = clock_timestamp(), last_error = null, lease_expires_at = null
  where id = v_job.id;

  -- A job started with the old worker may still have an unpublished PDF at
  -- its previous document key.
  insert into public.capture_storage_deletions (document_id, user_id, bucket_id, storage_path)
  select v_job.document_id, v_job.user_id, 'job-descriptions', v_previous_path
  where v_previous_path <> v_output_path and exists (
    select 1 from storage.objects where bucket_id = 'job-descriptions' and name = v_previous_path
  )
  on conflict (document_id, bucket_id, storage_path) do nothing;

  insert into public.application_events (
    application_id, user_id, event_type, event_time, source, evidence, previous_status, new_status
  ) values (
    v_job.application_id, v_job.user_id, 'JD_SAVED', now(), 'SYSTEM',
    'Job description captured as PDF', v_application_status, v_application_status
  );

  return true;
end;
$$;

create function public.fail_capture_attempt(p_job_id uuid, p_attempt_id uuid, p_error text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.capture_jobs%rowtype;
  v_status public.capture_status;
begin
  select * into v_job from public.capture_jobs
  where id = p_job_id and attempt_id = p_attempt_id and status = 'PROCESSING'
  for update;

  if not found or v_job.lease_expires_at is null or v_job.lease_expires_at <= clock_timestamp() then
    return false;
  end if;

  v_status := case when v_job.attempt_count >= 3 then 'FAILED' else 'PENDING' end;
  update public.capture_jobs
  set status = v_status,
      available_at = case when v_status = 'PENDING' then clock_timestamp() + case v_job.attempt_count
        when 1 then interval '5 seconds'
        when 2 then interval '30 seconds'
        else interval '5 minutes'
      end end,
      last_error = left(coalesce(p_error, 'Capture failed'), 2000),
      attempt_id = null,
      lease_expires_at = null
  where id = v_job.id;

  update public.documents
  set capture_status = v_status
  where id = v_job.document_id and user_id = v_job.user_id;

  return true;
end;
$$;

create function public.queue_abandoned_capture_outputs()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uuid constant text := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  v_count integer;
begin
  -- Find actual files, including uploads that finished after their claim
  -- expired or after an earlier cleanup pass. Until the job releases the
  -- attempt, skip it even if its lease time has passed: a completion
  -- transaction may already hold its lock and be about to publish the file.
  insert into public.capture_storage_deletions (document_id, user_id, bucket_id, storage_path)
  select parts.ids[2]::uuid, parts.ids[1]::uuid, 'job-descriptions', s.name
  from storage.objects s
  cross join lateral regexp_match(
    s.name, '^(' || v_uuid || ')/capture-attempts/(' || v_uuid || ')/(' || v_uuid || ')[.]pdf$'
  ) as parts(ids)
  where s.bucket_id = 'job-descriptions' and parts.ids is not null
    and not exists (
      select 1 from public.documents d where d.storage_path = s.name
    )
    and not exists (
      select 1 from public.capture_jobs j
      where j.document_id = parts.ids[2]::uuid and j.user_id = parts.ids[1]::uuid
        and j.status = 'PROCESSING' and j.attempt_id = parts.ids[3]::uuid
    )
    and not exists (
      select 1 from public.capture_storage_deletions q
      where q.document_id = parts.ids[2]::uuid and q.bucket_id = 'job-descriptions' and q.storage_path = s.name
    )
  order by s.created_at, s.name
  limit 20
  on conflict (document_id, bucket_id, storage_path) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.claim_capture_attempt(),
  public.complete_capture_attempt(uuid, uuid, bigint, text),
  public.fail_capture_attempt(uuid, uuid, text),
  public.queue_abandoned_capture_outputs() from public, anon, authenticated;
grant execute on function public.claim_capture_attempt(),
  public.complete_capture_attempt(uuid, uuid, bigint, text),
  public.fail_capture_attempt(uuid, uuid, text),
  public.queue_abandoned_capture_outputs() to service_role;
