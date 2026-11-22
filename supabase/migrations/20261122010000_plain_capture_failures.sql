-- A failed save shows its error to the person who saved it, so the worker now
-- sends a plain message and says whether another attempt could help. A page
-- with no readable text, for example, fails at once instead of being retried
-- three times. Older workers call this with three arguments, which the default
-- keeps working.

drop function public.fail_capture_attempt(uuid, uuid, text);

create function public.fail_capture_attempt(
  p_job_id uuid,
  p_attempt_id uuid,
  p_error text,
  p_retryable boolean default true
)
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

  v_status := case
    when not coalesce(p_retryable, true) or v_job.attempt_count >= 3 then 'FAILED'
    else 'PENDING'
  end;
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

revoke all on function public.fail_capture_attempt(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.fail_capture_attempt(uuid, uuid, text, boolean) to service_role;

-- Earlier workers stored the converter's raw error, which can include the
-- container command and paths on the server. Replace it with the plain message.
update public.capture_jobs
set last_error = 'The PDF could not be created.'
where status in ('PENDING', 'FAILED')
  and last_error like 'Command failed:%';
