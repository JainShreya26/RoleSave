-- Checks the cleanup migration: the rate-limit objects are gone, the unread
-- trigram index is gone, and review tasks are opened on demand rather than by
-- an insert trigger.
--
-- Run through scripts/test-cleanup-migration.sh, which builds the pre-migration
-- schema first and then applies the migration under test.

begin;

-- ---------------------------------------------------------------------------
-- Removed objects
-- ---------------------------------------------------------------------------

do $$ begin
  if to_regclass('public.webhook_rate_limits') is not null then
    raise exception 'webhook_rate_limits still exists';
  end if;
  if exists (
    select 1 from pg_proc
    join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where pg_namespace.nspname = 'public' and pg_proc.proname = 'consume_webhook_rate_limit'
  ) then
    raise exception 'consume_webhook_rate_limit still exists';
  end if;
  if to_regclass('public.applications_position_trgm_idx') is not null then
    raise exception 'applications_position_trgm_idx still exists';
  end if;
  if exists (
    select 1 from pg_trigger
    where tgrelid = 'public.email_events'::regclass
      and tgname = 'email_events_create_review_task'
  ) then
    raise exception 'the default review task trigger still exists';
  end if;
end $$;

-- Exactly one purge signature should remain, and it must not ask for a
-- rate-limit retention window any more.
do $$
declare
  v_signatures integer;
begin
  select count(*) into v_signatures
  from pg_proc
  join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
  where pg_namespace.nspname = 'public'
    and pg_proc.proname = 'purge_expired_operational_data';
  if v_signatures <> 1 then
    raise exception 'expected one purge signature, found %', v_signatures;
  end if;
  if pg_get_function_identity_arguments(
       (select pg_proc.oid from pg_proc
        join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
        where pg_namespace.nspname = 'public'
          and pg_proc.proname = 'purge_expired_operational_data')
     ) <> 'p_failed_metadata_retention_days integer' then
    raise exception 'the purge function no longer takes only the metadata retention window';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Review tasks are created only when a person has to choose
-- ---------------------------------------------------------------------------

insert into public.applications (id, user_id, company, company_normalized, position, position_normalized, status, source)
values
  ('11111111-1111-1111-1111-111111111111', '99999999-9999-9999-9999-999999999999',
   'Northwind', 'northwind', 'AI Analyst', 'ai analyst', 'APPLIED', 'EXTENSION'),
  ('22222222-2222-2222-2222-222222222222', '99999999-9999-9999-9999-999999999999',
   'Northwind', 'northwind', 'Data Scientist', 'data scientist', 'SAVED', 'EXTENSION');

insert into public.email_events (id, user_id, review_status)
values ('33333333-3333-3333-3333-333333333333', '99999999-9999-9999-9999-999999999999', 'PENDING');

-- Storing the event must not have produced a review task on its own.
do $$ begin
  if exists (select 1 from public.review_tasks where email_event_id = '33333333-3333-3333-3333-333333333333') then
    raise exception 'a review task was created before the match outcome was known';
  end if;
end $$;

-- An uncertain match opens the task, preserving the worker's ranking.
do $$
declare
  v_opened boolean;
  v_suggestions uuid[];
  v_count integer;
begin
  v_opened := public.set_email_review_suggestions(
    '33333333-3333-3333-3333-333333333333',
    array['22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111']::uuid[],
    'Review required: exact company.',
    0.5
  );
  if not v_opened then raise exception 'the review task was not opened'; end if;

  select suggested_application_ids into v_suggestions
  from public.review_tasks where email_event_id = '33333333-3333-3333-3333-333333333333';
  if v_suggestions[1] <> '22222222-2222-2222-2222-222222222222'::uuid then
    raise exception 'the caller ranking was not preserved: %', v_suggestions;
  end if;

  -- Re-running matching refreshes the open task instead of adding a second.
  v_opened := public.set_email_review_suggestions(
    '33333333-3333-3333-3333-333333333333',
    array['11111111-1111-1111-1111-111111111111']::uuid[],
    'Review required: second pass.',
    0.6
  );
  if not v_opened then raise exception 'the open review task was not refreshed'; end if;

  select count(*) into v_count
  from public.review_tasks where email_event_id = '33333333-3333-3333-3333-333333333333';
  if v_count <> 1 then raise exception 'expected one review task, found %', v_count; end if;
end $$;

-- A task the user already settled is never reopened by a later pass.
do $$
declare
  v_reason text;
begin
  update public.review_tasks set status = 'RESOLVED'
  where email_event_id = '33333333-3333-3333-3333-333333333333';

  perform public.set_email_review_suggestions(
    '33333333-3333-3333-3333-333333333333',
    array['22222222-2222-2222-2222-222222222222']::uuid[],
    'Review required: should not apply.',
    0.4
  );

  select reason into v_reason
  from public.review_tasks where email_event_id = '33333333-3333-3333-3333-333333333333';
  if v_reason = 'Review required: should not apply.' then
    raise exception 'a resolved review task was reopened';
  end if;
end $$;

-- An application belonging to someone else is never suggested.
do $$
declare
  v_suggestions uuid[];
begin
  insert into public.email_events (id, user_id, review_status)
  values ('44444444-4444-4444-4444-444444444444', '99999999-9999-9999-9999-999999999999', 'PENDING');
  insert into public.applications (id, user_id, company, company_normalized, position, position_normalized, status, source)
  values ('55555555-5555-5555-5555-555555555555', '88888888-8888-8888-8888-888888888888',
          'Other Person Co', 'other person', 'Analyst', 'analyst', 'SAVED', 'EXTENSION');

  perform public.set_email_review_suggestions(
    '44444444-4444-4444-4444-444444444444',
    array['55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111']::uuid[],
    'Review required: ownership check.',
    0.5
  );

  select suggested_application_ids into v_suggestions
  from public.review_tasks where email_event_id = '44444444-4444-4444-4444-444444444444';
  if array_length(v_suggestions, 1) <> 1
    or v_suggestions[1] <> '11111111-1111-1111-1111-111111111111'::uuid then
    raise exception 'another user''s application leaked into the suggestions: %', v_suggestions;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Retention still works without the rate-limit table
-- ---------------------------------------------------------------------------

do $$
declare
  v_capture bigint;
  v_email bigint;
begin
  insert into public.documents (id, application_id, user_id, storage_path, capture_status, temporary_storage_path)
  values ('66666666-6666-6666-6666-666666666666', '11111111-1111-1111-1111-111111111111',
          '99999999-9999-9999-9999-999999999999', 'expired/doc.pdf', 'FAILED', null);
  insert into public.capture_jobs (id, user_id, application_id, document_id, idempotency_key, status, failed_at)
  values ('77777777-7777-7777-7777-777777777777', '99999999-9999-9999-9999-999999999999',
          '11111111-1111-1111-1111-111111111111', '66666666-6666-6666-6666-666666666666',
          gen_random_uuid(), 'FAILED', now() - interval '200 days');

  select capture_jobs_deleted, email_jobs_deleted
  into v_capture, v_email
  from public.purge_expired_operational_data(90);

  if v_capture <> 1 then raise exception 'expected one purged capture job, got %', v_capture; end if;
  if exists (select 1 from public.documents where id = '66666666-6666-6666-6666-666666666666') then
    raise exception 'the failed document was not purged with its job';
  end if;
end $$;

rollback;
