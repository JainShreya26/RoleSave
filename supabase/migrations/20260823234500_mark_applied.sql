create function public.mark_application_applied(p_application_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_application public.applications%rowtype;
  v_applied_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select * into v_application
  from public.applications
  where id = p_application_id and user_id = v_user_id
  for update;

  if v_application.id is null then
    return false;
  end if;

  if v_application.status = 'APPLIED' then
    return true;
  end if;

  if v_application.status <> 'SAVED' then
    return false;
  end if;

  v_applied_at := coalesce(v_application.applied_at, now());

  update public.applications
  set status = 'APPLIED', applied_at = v_applied_at
  where id = p_application_id and user_id = v_user_id;

  insert into public.application_events (
    application_id, user_id, event_type, event_time, source, evidence,
    previous_status, new_status
  ) values (
    p_application_id, v_user_id, 'MARKED_AS_APPLIED', v_applied_at, 'EXTENSION',
    'Marked as applied from the browser extension', 'SAVED', 'APPLIED'
  );

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
    'Job description captured as PDF', v_application_status, v_application_status
  );

  return true;
end;
$$;

revoke all on function public.mark_application_applied(uuid) from public;
grant execute on function public.mark_application_applied(uuid) to authenticated;
