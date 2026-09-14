-- User-controlled correction of resolved email matches.
--
-- A review decision must not be permanent. These functions detach the
-- generated timeline event, conservatively restore the old application's
-- prior status when no later status-changing action exists, and either reopen
-- review or attach the email to a different owned application atomically.

create function public.detach_email_event_match_internal(
  p_email_event_id uuid,
  p_reopen_review boolean
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_email public.email_events%rowtype;
  v_application public.applications%rowtype;
  v_timeline public.application_events%rowtype;
  v_status_reverted boolean := false;
begin
  select * into v_email
  from public.email_events
  where email_events.id = p_email_event_id
  for update;

  if v_email.id is null or v_email.application_id is null then
    return null;
  end if;

  if coalesce(auth.role(), '') <> 'service_role'
    and auth.uid() is distinct from v_email.user_id
  then
    return null;
  end if;

  select * into v_application
  from public.applications
  where applications.id = v_email.application_id
    and applications.user_id = v_email.user_id
  for update;

  if v_application.id is null then
    return null;
  end if;

  select * into v_timeline
  from public.application_events
  where application_events.application_id = v_application.id
    and application_events.user_id = v_email.user_id
    and application_events.provider_message_id = v_email.provider_message_id
    and application_events.event_type::text = v_email.classification
  order by application_events.created_at desc
  limit 1
  for update;

  if v_timeline.id is not null then
    delete from public.application_events
    where application_events.id = v_timeline.id;

    -- Revert only when this email still represents the current status and no
    -- later user or email action changed status. Otherwise detaching the email
    -- must not overwrite newer history.
    if v_timeline.previous_status is not null
      and v_timeline.new_status = v_application.status
      and not exists (
        select 1
        from public.application_events
        where application_events.application_id = v_application.id
          and application_events.created_at > v_timeline.created_at
          and application_events.new_status is not null
          and application_events.previous_status is distinct from application_events.new_status
      )
    then
      update public.applications
      set status = v_timeline.previous_status,
          applied_at = case
            when v_timeline.previous_status = 'SAVED' then null
            else applications.applied_at
          end
      where applications.id = v_application.id;
      v_status_reverted := v_timeline.previous_status is distinct from v_application.status;
    end if;

    insert into public.application_events (
      application_id, user_id, event_type, event_time, source, evidence,
      previous_status, new_status
    ) values (
      v_application.id,
      v_email.user_id,
      'MANUAL_CORRECTION',
      now(),
      'MANUAL',
      left('Removed email match: ' || v_email.subject, 2000),
      v_application.status,
      case
        when v_status_reverted then v_timeline.previous_status
        else v_application.status
      end
    );
  end if;

  update public.email_events
  set application_id = null,
      match_confidence = null,
      review_status = 'PENDING'
  where email_events.id = v_email.id;

  if p_reopen_review then
    insert into public.review_tasks (
      user_id, email_event_id, suggested_application_ids, reason, status,
      resolved_at
    ) values (
      v_email.user_id,
      v_email.id,
      array[v_application.id],
      'The previous email match was undone. Choose the correct application or dismiss the email.',
      'OPEN',
      null
    )
    on conflict (email_event_id) do update
      set suggested_application_ids = excluded.suggested_application_ids,
          reason = excluded.reason,
          status = 'OPEN',
          resolved_at = null;
  end if;

  return v_application.id;
end;
$$;

create function public.undo_email_event_match(p_email_event_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
begin
  return public.detach_email_event_match_internal(p_email_event_id, true) is not null;
end;
$$;

create function public.reassign_email_event_match(
  p_email_event_id uuid,
  p_application_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_email public.email_events%rowtype;
  v_old_application_id uuid;
  v_attached boolean;
begin
  select * into v_email
  from public.email_events
  where email_events.id = p_email_event_id;

  if v_email.id is null or v_email.application_id is null then
    return false;
  end if;

  if coalesce(auth.role(), '') <> 'service_role'
    and auth.uid() is distinct from v_email.user_id
  then
    return false;
  end if;

  if v_email.application_id = p_application_id then
    return true;
  end if;

  if not exists (
    select 1
    from public.applications
    where applications.id = p_application_id
      and applications.user_id = v_email.user_id
  ) then
    return false;
  end if;

  v_old_application_id := public.detach_email_event_match_internal(
    p_email_event_id,
    false
  );
  if v_old_application_id is null then
    return false;
  end if;

  v_attached := public.attach_email_event_to_application(
    p_email_event_id,
    p_application_id,
    1,
    'CORRECTED'
  );
  if not v_attached then
    raise exception 'Email event could not be attached to the selected application';
  end if;

  return true;
end;
$$;

revoke all on function public.detach_email_event_match_internal(uuid, boolean)
  from public, anon, authenticated, service_role;

revoke all on function public.undo_email_event_match(uuid) from public;
grant execute on function public.undo_email_event_match(uuid)
  to authenticated, service_role;

revoke all on function public.reassign_email_event_match(uuid, uuid) from public;
grant execute on function public.reassign_email_event_match(uuid, uuid)
  to authenticated, service_role;
