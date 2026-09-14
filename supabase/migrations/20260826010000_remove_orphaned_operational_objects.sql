-- Remove operational objects that no longer have a caller.
--
-- RoleSave runs only on its owner's machine. The web app now serves no HTTP
-- endpoints at all, so there is no public surface left to rate limit, and mail
-- arrives by the worker polling Resend rather than by an inbound webhook. This
-- drops what that removed surface left behind, an index nothing reads, and a
-- trigger that manufactured review work only to resolve it moments later.

-- ---------------------------------------------------------------------------
-- 1. Webhook rate limiting
-- ---------------------------------------------------------------------------

-- The parameter list changes, so the old signature is dropped rather than
-- replaced: leaving it in place would keep a function that reads a table this
-- migration removes.
drop function if exists public.purge_expired_operational_data(integer, integer);
drop function if exists public.consume_webhook_rate_limit(text, integer, integer);
drop table if exists public.webhook_rate_limits;

create or replace function public.purge_expired_operational_data(
  p_failed_metadata_retention_days integer default 90
)
returns table (
  capture_jobs_deleted bigint,
  email_jobs_deleted bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_capture_jobs_deleted bigint;
  v_email_jobs_deleted bigint;
begin
  if p_failed_metadata_retention_days not between 30 and 3650 then
    raise exception 'Failed-job metadata retention must be between 30 and 3650 days';
  end if;

  -- Metadata is only removed once its private payload is already gone, so a
  -- replayable failure is never silently dropped.
  with deleted_jobs as (
    delete from public.capture_jobs
    where capture_jobs.status = 'FAILED'
      and capture_jobs.failed_at < now() - make_interval(days => p_failed_metadata_retention_days)
      and exists (
        select 1 from public.documents
        where documents.id = capture_jobs.document_id
          and documents.temporary_storage_path is null
      )
    returning capture_jobs.document_id
  ), deleted_documents as (
    delete from public.documents
    using deleted_jobs
    where documents.id = deleted_jobs.document_id
      and documents.capture_status = 'FAILED'
      and documents.temporary_storage_path is null
    returning documents.id
  )
  select count(*) into v_capture_jobs_deleted from deleted_jobs;

  delete from public.inbound_email_jobs
  where inbound_email_jobs.status = 'FAILED'
    and inbound_email_jobs.failed_at < now() - make_interval(days => p_failed_metadata_retention_days)
    and inbound_email_jobs.storage_deleted_at is not null;
  get diagnostics v_email_jobs_deleted = row_count;

  return query select v_capture_jobs_deleted, v_email_jobs_deleted;
end;
$$;

comment on function public.purge_expired_operational_data(integer) is
  'Deletes failed queue metadata whose private payload has already been removed.';

revoke all on function public.purge_expired_operational_data(integer)
  from public, anon, authenticated;
grant execute on function public.purge_expired_operational_data(integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- 2. Unread search index
-- ---------------------------------------------------------------------------

-- A trigram index over position_normalized was built for a role search that
-- was never implemented. Nothing queries the column, so the index only costs
-- write time on every capture. The column itself stays until the functions
-- that insert it are next rewritten.
drop index if exists public.applications_position_trgm_idx;

-- ---------------------------------------------------------------------------
-- 3. Review tasks created on demand
-- ---------------------------------------------------------------------------

-- Every job-related email used to insert an open review task reading
-- "Application matching is pending", which the worker then resolved a moment
-- later. The queue is what makes matching failure recoverable, so the task no
-- longer needs to exist before the outcome is known: it is created only when
-- a person actually has to choose.
drop trigger if exists email_events_create_review_task on public.email_events;
drop function if exists public.create_default_email_review_task();

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

  -- The worker's ranking is the matcher's verdict. Ownership is re-checked
  -- here, but the caller's order is preserved so the dashboard never presents
  -- a weaker candidate first.
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

  -- One review task per email event. Re-running matching for the same message
  -- refreshes the open task instead of creating a second one, and never
  -- reopens a task the user has already settled.
  insert into public.review_tasks (user_id, email_event_id, suggested_application_ids, reason)
  values (
    v_user_id,
    p_email_event_id,
    v_valid_ids,
    left(coalesce(p_reason, 'Application match requires review.'), 1000)
  )
  on conflict (email_event_id) do update
    set suggested_application_ids = excluded.suggested_application_ids,
        reason = excluded.reason
    where public.review_tasks.status = 'OPEN';

  return found;
end;
$$;

comment on function public.set_email_review_suggestions(uuid, uuid[], text, numeric) is
  'Opens or refreshes the review task for an email the matcher could not settle.';

revoke execute on function public.set_email_review_suggestions(uuid, uuid[], text, numeric)
  from public, anon, authenticated;
grant execute on function public.set_email_review_suggestions(uuid, uuid[], text, numeric)
  to service_role;
