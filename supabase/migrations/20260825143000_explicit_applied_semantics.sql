-- Keep the user's explicit "Mark as Applied" action separate from email
-- evidence. An application-confirmation email is recorded in the timeline but
-- does not set APPLIED or applied_at on the user's behalf.

create or replace function public.attach_email_event_to_application(
  p_email_event_id uuid,
  p_application_id uuid,
  p_match_confidence numeric,
  p_review_status text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_email public.email_events%rowtype;
  v_application public.applications%rowtype;
  v_candidate_status public.application_status;
  v_new_status public.application_status;
  v_latest_status_event_time timestamptz;
  v_current_rank integer;
  v_candidate_rank integer;
begin
  select * into v_email
  from public.email_events
  where id = p_email_event_id
  for update;

  select * into v_application
  from public.applications
  where id = p_application_id
  for update;

  if v_email.id is null or v_application.id is null
    or v_email.user_id <> v_application.user_id
    or v_email.classification = 'NOT_JOB_RELATED' then
    return false;
  end if;

  v_candidate_status := case v_email.classification
    -- Confirmation is evidence, not the user's explicit extension action.
    when 'APPLICATION_CONFIRMED' then v_application.status
    when 'ASSESSMENT_REQUESTED' then 'ASSESSMENT'::public.application_status
    when 'INTERVIEW_REQUESTED' then 'INTERVIEW'::public.application_status
    when 'OFFER_RECEIVED' then 'OFFER'::public.application_status
    when 'REJECTION_RECEIVED' then 'REJECTED'::public.application_status
    else v_application.status
  end;
  v_new_status := v_application.status;

  select max(application_events.event_time)
  into v_latest_status_event_time
  from public.application_events
  where application_events.application_id = v_application.id
    and application_events.new_status is not null
    and (
      application_events.previous_status is null
      or application_events.previous_status <> application_events.new_status
    );
  v_latest_status_event_time := coalesce(v_latest_status_event_time, v_application.created_at);

  v_current_rank := case v_application.status
    when 'SAVED' then 0
    when 'NEEDS_REVIEW' then 0
    when 'APPLIED' then 10
    when 'ASSESSMENT' then 20
    when 'INTERVIEW' then 30
    else 100
  end;
  v_candidate_rank := case v_candidate_status
    when 'SAVED' then 0
    when 'NEEDS_REVIEW' then 0
    when 'APPLIED' then 10
    when 'ASSESSMENT' then 20
    when 'INTERVIEW' then 30
    else 100
  end;

  if v_application.status not in ('OFFER', 'REJECTED', 'WITHDRAWN')
    and v_email.received_at >= v_latest_status_event_time
    and v_candidate_rank >= v_current_rank then
    v_new_status := v_candidate_status;
  end if;

  update public.email_events
  set application_id = v_application.id,
      match_confidence = p_match_confidence,
      review_status = p_review_status
  where id = v_email.id;

  -- Email processing may advance the lifecycle, but applied_at belongs to the
  -- user's explicit extension or manual action and is never inferred here.
  update public.applications
  set status = v_new_status
  where id = v_application.id;

  insert into public.application_events (
    application_id, user_id, event_type, event_time, source, confidence,
    evidence, provider_message_id, previous_status, new_status
  ) values (
    v_application.id,
    v_application.user_id,
    v_email.classification::public.application_event_type,
    v_email.received_at,
    'EMAIL',
    v_email.classification_confidence,
    left('Email: ' || v_email.subject || ' — ' || v_email.evidence, 2000),
    v_email.provider_message_id,
    v_application.status,
    v_new_status
  )
  on conflict (user_id, provider_message_id, event_type)
    where provider_message_id is not null
  do nothing;

  update public.review_tasks
  set status = 'RESOLVED', resolved_at = now()
  where email_event_id = v_email.id and status = 'OPEN';

  return true;
end;
$$;

-- Correct historical rows where the only evidence for APPLIED was a
-- confirmation email and applied_at was inferred from that email's timestamp.
with email_only_applied as (
  select distinct applications.id
  from public.applications
  join public.application_events confirmation
    on confirmation.application_id = applications.id
   and confirmation.event_type = 'APPLICATION_CONFIRMED'
   and confirmation.source = 'EMAIL'
   and confirmation.previous_status = 'SAVED'
   and confirmation.new_status = 'APPLIED'
  where applications.status = 'APPLIED'
    and applications.applied_at = confirmation.event_time
    and not exists (
      select 1
      from public.application_events explicit_action
      where explicit_action.application_id = applications.id
        and (
          explicit_action.event_type = 'MARKED_AS_APPLIED'
          or (
            explicit_action.source = 'MANUAL'
            and explicit_action.new_status is not null
            and explicit_action.new_status <> 'SAVED'
          )
        )
    )
)
update public.applications
set status = 'SAVED', applied_at = null
where applications.id in (select id from email_only_applied);

update public.application_events
set new_status = previous_status
where application_events.event_type = 'APPLICATION_CONFIRMED'
  and application_events.source = 'EMAIL'
  and application_events.previous_status is not null
  and application_events.new_status is distinct from application_events.previous_status;

revoke all on function public.attach_email_event_to_application(uuid, uuid, numeric, text)
  from public, anon, authenticated;
