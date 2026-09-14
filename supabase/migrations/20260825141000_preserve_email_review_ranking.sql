-- Preserve the worker's candidate ranking when storing review suggestions.
--
-- The previous implementation validated candidate ownership by aggregating
-- application rows without an ORDER BY. PostgreSQL is free to return those
-- rows in any order, so the dashboard could preselect a weaker or unrelated
-- candidate even though the worker ranked the correct application first.

create or replace function public.set_email_review_suggestions(
  p_email_event_id uuid,
  p_suggested_application_ids uuid[],
  p_reason text,
  p_match_confidence numeric
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_user_id uuid;
  v_valid_ids uuid[];
begin
  select email_events.user_id into v_user_id
  from public.email_events
  where email_events.id = p_email_event_id
    and email_events.review_status = 'PENDING';

  if v_user_id is null then
    return false;
  end if;

  select coalesce(
    array_agg(suggestions.application_id order by suggestions.first_position),
    '{}'::uuid[]
  )
  into v_valid_ids
  from (
    select requested.application_id, min(requested.position) as first_position
    from unnest(coalesce(p_suggested_application_ids, '{}'::uuid[]))
      with ordinality as requested(application_id, position)
    join public.applications
      on applications.id = requested.application_id
     and applications.user_id = v_user_id
    group by requested.application_id
  ) as suggestions;

  update public.email_events
  set match_confidence = p_match_confidence
  where email_events.id = p_email_event_id;

  update public.review_tasks
  set suggested_application_ids = v_valid_ids,
      reason = left(coalesce(p_reason, 'Application match requires review.'), 1000)
  where review_tasks.email_event_id = p_email_event_id
    and review_tasks.status = 'OPEN';

  return found;
end;
$$;

revoke execute on function public.set_email_review_suggestions(uuid, uuid[], text, numeric)
  from public, anon, authenticated;
grant execute on function public.set_email_review_suggestions(uuid, uuid[], text, numeric)
  to service_role;
