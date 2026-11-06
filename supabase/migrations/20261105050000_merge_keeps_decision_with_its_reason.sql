-- Keep a saved-role decision together with its own reason when merging.
--
-- The merge chose the decision and the reason separately. A kept role marked
-- Pursue with no reason could take the reason from a duplicate marked Pass, which
-- then explained a decision it was never written for. The reason now comes from
-- whichever role the decision came from.

create or replace function public._merge_application_records(
  p_keep_application_id uuid,
  p_merge_application_id uuid,
  p_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_keep public.applications%rowtype;
  v_merge public.applications%rowtype;
begin
  if p_keep_application_id = p_merge_application_id then
    return p_keep_application_id;
  end if;

  perform 1
  from public.applications
  where id in (p_keep_application_id, p_merge_application_id)
  order by id
  for update;

  select * into v_keep from public.applications
  where id = p_keep_application_id and user_id = p_user_id;
  select * into v_merge from public.applications
  where id = p_merge_application_id and user_id = p_user_id;

  if v_keep.id is null or v_merge.id is null then
    raise exception 'Both applications must exist and belong to the same user';
  end if;

  update public.capture_jobs set application_id = v_keep.id
  where application_id = v_merge.id;
  update public.documents set application_id = v_keep.id
  where application_id = v_merge.id;
  update public.application_events set application_id = v_keep.id
  where application_id = v_merge.id;
  update public.application_actions set application_id = v_keep.id
  where application_id = v_merge.id;
  update public.application_attachments set application_id = v_keep.id
  where application_id = v_merge.id;

  delete from public.applications where id = v_merge.id;

  update public.applications
  set status = case
        when public.application_status_rank(v_merge.status) > public.application_status_rank(v_keep.status)
          then v_merge.status
        else v_keep.status
      end,
      applied_at = case
        when v_keep.applied_at is null then v_merge.applied_at
        when v_merge.applied_at is null then v_keep.applied_at
        else least(v_keep.applied_at, v_merge.applied_at)
      end,
      original_url = coalesce(v_keep.original_url, v_merge.original_url),
      job_id = coalesce(v_keep.job_id, v_merge.job_id),
      triage_decision = coalesce(v_keep.triage_decision, v_merge.triage_decision),
      triage_reason = case
        when v_keep.triage_decision is not null then v_keep.triage_reason
        else v_merge.triage_reason
      end
  where id = v_keep.id;

  insert into public.application_events (
    application_id, user_id, event_type, event_time, source, evidence,
    previous_status, new_status
  )
  select
    v_keep.id, p_user_id, 'MANUAL_CORRECTION', now(), 'SYSTEM',
    'Exact duplicate application consolidated; linked documents, attachments, actions, and timeline history were preserved.',
    applications.status, applications.status
  from public.applications
  where id = v_keep.id;

  return v_keep.id;
end;
$$;

revoke all on function public._merge_application_records(uuid, uuid, uuid) from public;
