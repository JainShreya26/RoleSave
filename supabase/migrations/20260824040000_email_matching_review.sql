alter table public.email_events
  add column match_confidence numeric check (match_confidence between 0 and 1),
  add column review_status text not null default 'PENDING' check (review_status in (
    'NOT_REQUIRED', 'PENDING', 'CONFIRMED', 'CORRECTED', 'DISMISSED'
  ));

update public.email_events
set review_status = 'NOT_REQUIRED'
where classification = 'NOT_JOB_RELATED';

create table public.review_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email_event_id uuid not null unique references public.email_events(id) on delete cascade,
  suggested_application_ids uuid[] not null default '{}',
  reason text not null,
  status text not null default 'OPEN' check (status in ('OPEN', 'RESOLVED', 'DISMISSED')),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index review_tasks_user_open_idx
  on public.review_tasks(user_id, created_at desc)
  where status = 'OPEN';

alter table public.review_tasks enable row level security;

create policy review_tasks_select_own on public.review_tasks
for select to authenticated using ((select auth.uid()) = user_id);

grant select on public.review_tasks to authenticated;

create function public.create_default_email_review_task()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
begin
  if new.classification <> 'NOT_JOB_RELATED' then
    insert into public.review_tasks (user_id, email_event_id, reason)
    values (new.user_id, new.id, 'Application matching is pending.');
  end if;
  return new;
end;
$$;

create trigger email_events_create_review_task
after insert on public.email_events
for each row execute function public.create_default_email_review_task();

insert into public.review_tasks (user_id, email_event_id, reason)
select user_id, id, 'Application matching is pending.'
from public.email_events
where classification <> 'NOT_JOB_RELATED'
on conflict (email_event_id) do nothing;

create unique index application_events_provider_event_idx
  on public.application_events(user_id, provider_message_id, event_type)
  where provider_message_id is not null;

create function public.attach_email_event_to_application(
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
  v_new_status public.application_status;
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

  v_new_status := case v_email.classification
    when 'APPLICATION_CONFIRMED' then 'APPLIED'::public.application_status
    when 'ASSESSMENT_REQUESTED' then 'ASSESSMENT'::public.application_status
    when 'INTERVIEW_REQUESTED' then 'INTERVIEW'::public.application_status
    when 'OFFER_RECEIVED' then 'OFFER'::public.application_status
    when 'REJECTION_RECEIVED' then 'REJECTED'::public.application_status
    else v_application.status
  end;

  update public.email_events
  set application_id = v_application.id,
      match_confidence = p_match_confidence,
      review_status = p_review_status
  where id = v_email.id;

  update public.applications
  set status = v_new_status,
      applied_at = case
        when applied_at is null and v_new_status <> 'SAVED' then v_email.received_at
        else applied_at
      end
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

create function public.apply_automatic_email_match(
  p_email_event_id uuid,
  p_application_id uuid,
  p_match_confidence numeric
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
begin
  return public.attach_email_event_to_application(
    p_email_event_id, p_application_id, p_match_confidence, 'NOT_REQUIRED'
  );
end;
$$;

create function public.set_email_review_suggestions(
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
  select user_id into v_user_id
  from public.email_events
  where id = p_email_event_id and review_status = 'PENDING';

  if v_user_id is null then
    return false;
  end if;

  select coalesce(array_agg(applications.id), '{}'::uuid[]) into v_valid_ids
  from public.applications
  where user_id = v_user_id and id = any(coalesce(p_suggested_application_ids, '{}'::uuid[]));

  update public.email_events
  set match_confidence = p_match_confidence
  where id = p_email_event_id;

  update public.review_tasks
  set suggested_application_ids = v_valid_ids,
      reason = left(coalesce(p_reason, 'Application match requires review.'), 1000)
  where email_event_id = p_email_event_id and status = 'OPEN';

  return found;
end;
$$;

create function public.resolve_email_review_task(
  p_review_task_id uuid,
  p_application_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_user_id uuid := auth.uid();
  v_email_event_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select email_event_id into v_email_event_id
  from public.review_tasks
  where id = p_review_task_id and user_id = v_user_id and status = 'OPEN';

  if v_email_event_id is null or not exists (
    select 1 from public.applications
    where id = p_application_id and user_id = v_user_id
  ) then
    return false;
  end if;

  return public.attach_email_event_to_application(
    v_email_event_id, p_application_id, 1, 'CONFIRMED'
  );
end;
$$;

create function public.dismiss_email_review_task(p_review_task_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_user_id uuid := auth.uid();
  v_email_event_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select email_event_id into v_email_event_id
  from public.review_tasks
  where id = p_review_task_id and user_id = v_user_id and status = 'OPEN'
  for update;

  if v_email_event_id is null then
    return false;
  end if;

  update public.email_events
  set classification = 'NOT_JOB_RELATED', review_status = 'DISMISSED',
      application_id = null, match_confidence = null
  where id = v_email_event_id and user_id = v_user_id;

  update public.review_tasks
  set status = 'DISMISSED', resolved_at = now()
  where id = p_review_task_id;

  return true;
end;
$$;

revoke all on function public.create_default_email_review_task() from public;
revoke all on function public.attach_email_event_to_application(uuid, uuid, numeric, text) from public;
revoke all on function public.apply_automatic_email_match(uuid, uuid, numeric) from public;
revoke all on function public.set_email_review_suggestions(uuid, uuid[], text, numeric) from public;
revoke all on function public.resolve_email_review_task(uuid, uuid) from public;
revoke all on function public.dismiss_email_review_task(uuid) from public;
grant execute on function public.apply_automatic_email_match(uuid, uuid, numeric) to service_role;
grant execute on function public.set_email_review_suggestions(uuid, uuid[], text, numeric) to service_role;
grant execute on function public.resolve_email_review_task(uuid, uuid) to authenticated;
grant execute on function public.dismiss_email_review_task(uuid) to authenticated;
