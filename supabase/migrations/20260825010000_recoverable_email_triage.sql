alter table public.email_events
  add column body_preview text
  check (body_preview is null or char_length(body_preview) <= 4000);

create index email_events_user_ignored_idx
  on public.email_events(user_id, received_at desc)
  where classification = 'NOT_JOB_RELATED'
    and review_status = 'NOT_REQUIRED'
    and application_id is null;

create function public.restore_ignored_email_event(
  p_email_event_id uuid,
  p_application_id uuid,
  p_classification text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_classification not in (
    'APPLICATION_CONFIRMED', 'ASSESSMENT_REQUESTED', 'INTERVIEW_REQUESTED',
    'OFFER_RECEIVED', 'REJECTION_RECEIVED', 'UNKNOWN_EMAIL_EVENT'
  ) then
    raise exception 'Unsupported email classification';
  end if;

  if not exists (
    select 1
    from public.applications
    where id = p_application_id and user_id = v_user_id
  ) then
    return false;
  end if;

  update public.email_events
  set classification = p_classification,
      classification_confidence = 1,
      review_status = 'PENDING',
      evidence = left('Manually restored. ' || evidence, 1000)
  where id = p_email_event_id
    and user_id = v_user_id
    and classification = 'NOT_JOB_RELATED'
    and review_status = 'NOT_REQUIRED'
    and application_id is null;

  if not found then
    return false;
  end if;

  return public.attach_email_event_to_application(
    p_email_event_id,
    p_application_id,
    1,
    'CORRECTED'
  );
end;
$$;

revoke all on function public.restore_ignored_email_event(uuid, uuid, text) from public;
grant execute on function public.restore_ignored_email_event(uuid, uuid, text) to authenticated;
