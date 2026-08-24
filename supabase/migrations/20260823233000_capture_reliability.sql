create function public.retry_capture_upload(p_job_id uuid)
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

create function public.retry_failed_capture(p_document_id uuid)
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
  set status = 'PENDING', available_at = now(), completed_at = null, last_error = null
  where id = v_job_id and user_id = v_user_id;

  update public.documents
  set capture_status = 'PENDING', file_size_bytes = null, checksum_sha256 = null
  where id = p_document_id and user_id = v_user_id;

  return true;
end;
$$;

revoke all on function public.retry_capture_upload(uuid) from public;
revoke all on function public.retry_failed_capture(uuid) from public;

grant execute on function public.retry_capture_upload(uuid) to authenticated;
grant execute on function public.retry_failed_capture(uuid) to authenticated;
