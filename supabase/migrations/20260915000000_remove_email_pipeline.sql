-- Remove the entire inbound-email pipeline.
--
-- Free-form email formats vary too much across ATS platforms and employers
-- for reliable automated classification and matching. Rather than adding more
-- heuristics, RoleSave drops email ingestion entirely: forwarding addresses,
-- Resend polling, classification, matching, and the review queue for
-- uncertain matches. Applications are tracked from the extension capture and
-- manual updates only.

-- ---------------------------------------------------------------------------
-- 1. Shared functions: strip email-only statements before their tables go
-- ---------------------------------------------------------------------------

create or replace function public.normalize_application_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_identity record;
begin
  new.company := trim(new.company);
  new.position := trim(new.position);
  new.company_normalized := coalesce(
    public.normalize_company_name(new.company),
    lower(regexp_replace(new.company, '\s+', ' ', 'g'))
  );
  new.position_normalized := lower(regexp_replace(new.position, '\s+', ' ', 'g'));

  if new.original_url is not null then
    new.original_domain := lower(split_part(split_part(new.original_url, '://', 2), '/', 1));

    select * into v_identity from public.ats_identity(new.original_url);
    new.ats_provider := v_identity.provider;
    new.ats_tenant := v_identity.tenant;
    new.ats_job_id := v_identity.job_id;
  else
    new.original_domain := null;
    new.ats_provider := null;
    new.ats_tenant := null;
    new.ats_job_id := null;
  end if;

  new.identity_key := public.application_identity_key(new.original_url, new.company, new.job_id);

  return new;
end;
$$;

drop function if exists public.purge_expired_operational_data(integer);

create function public.purge_expired_operational_data(
  p_failed_metadata_retention_days integer default 90
)
returns table (
  capture_jobs_deleted bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_capture_jobs_deleted bigint;
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

  return query select v_capture_jobs_deleted;
end;
$$;

comment on function public.purge_expired_operational_data(integer) is
  'Deletes failed capture-job metadata whose private payload has already been removed.';

revoke all on function public.purge_expired_operational_data(integer)
  from public, anon, authenticated;
grant execute on function public.purge_expired_operational_data(integer)
  to service_role;

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

  -- Deterministic lock order avoids deadlocks when two merge requests touch
  -- the same pair at the same time.
  perform 1
  from public.applications
  where id in (p_keep_application_id, p_merge_application_id)
  order by id
  for update;

  select * into v_keep
  from public.applications
  where id = p_keep_application_id and user_id = p_user_id;

  select * into v_merge
  from public.applications
  where id = p_merge_application_id and user_id = p_user_id;

  if v_keep.id is null or v_merge.id is null then
    raise exception 'Both applications must exist and belong to the same user';
  end if;

  -- Preserve the furthest recorded pipeline state and earliest known apply
  -- time. A later duplicate capture must never downgrade a real application.
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
      job_id = coalesce(v_keep.job_id, v_merge.job_id)
  where id = v_keep.id;

  -- Repoint every dependent record before deleting the redundant shell.
  update public.capture_jobs
  set application_id = v_keep.id
  where application_id = v_merge.id;

  update public.documents
  set application_id = v_keep.id
  where application_id = v_merge.id;

  update public.application_events
  set application_id = v_keep.id
  where application_id = v_merge.id;

  delete from public.applications where id = v_merge.id;

  insert into public.application_events (
    application_id, user_id, event_type, event_time, source, evidence,
    previous_status, new_status
  )
  select
    v_keep.id, p_user_id, 'MANUAL_CORRECTION', now(), 'SYSTEM',
    'Exact duplicate application consolidated; linked documents and timeline history were preserved.',
    applications.status, applications.status
  from public.applications
  where id = v_keep.id;

  return v_keep.id;
end;
$$;

revoke all on function public._merge_application_records(uuid, uuid, uuid) from public;

-- ---------------------------------------------------------------------------
-- 2. Drop email-only tables, in FK order
--
-- This runs before the function drops below because a live trigger
-- (email_events_set_initial_review_status) depends on
-- set_initial_email_review_status(); dropping its table first removes the
-- trigger along with it, so the function can then be dropped cleanly.
-- ---------------------------------------------------------------------------

drop table if exists public.review_tasks;
drop table if exists public.email_events;
drop table if exists public.inbound_email_jobs;
drop table if exists public.email_accounts;

-- ---------------------------------------------------------------------------
-- 3. Drop email-only functions
--
-- Runs before the enum drops below because issue_forwarding_address(text)
-- returns a table shaped with public.email_provider.
-- ---------------------------------------------------------------------------

drop function if exists public.issue_forwarding_address(text);
drop function if exists public.prepare_inbound_email_job(text, text);
drop function if exists public.finalize_inbound_email_upload(uuid, bigint);
drop function if exists public.fail_inbound_email_upload(uuid, text);
drop function if exists public.claim_inbound_email_job();
drop function if exists public.complete_inbound_email_job(
  uuid, text, text, text, text, text, text, timestamptz, text, text, text,
  numeric, integer, text
);
drop function if exists public.fail_inbound_email_job(uuid, text);
drop function if exists public.retry_failed_email_job(uuid);
drop function if exists public.attach_email_event_to_application(uuid, uuid, numeric, text);
drop function if exists public.apply_automatic_email_match(uuid, uuid, numeric);
drop function if exists public.set_email_review_suggestions(uuid, uuid[], text, numeric);
drop function if exists public.resolve_email_review_task(uuid, uuid);
drop function if exists public.dismiss_email_review_task(uuid);
drop function if exists public.set_initial_email_review_status();
drop function if exists public.restore_ignored_email_event(uuid, uuid, text);
drop function if exists public.match_email_candidates(
  uuid, text[], text[], text[], text[], timestamptz, uuid
);
drop function if exists public.detach_email_event_match_internal(uuid, boolean);
drop function if exists public.undo_email_event_match(uuid);
drop function if exists public.reassign_email_event_match(uuid, uuid);
drop function if exists public.company_search_tokens(text, text);

drop type if exists public.email_provider;
drop type if exists public.email_job_status;

-- ---------------------------------------------------------------------------
-- 4. Drop the fingerprint column that only fed email matching
-- ---------------------------------------------------------------------------

alter table public.applications drop column if exists company_tokens;

-- ---------------------------------------------------------------------------
-- 5. Retire timeline history that only makes sense next to a deleted email
-- ---------------------------------------------------------------------------

drop index if exists public.application_events_provider_event_idx;

delete from public.application_events where source = 'EMAIL';

-- ---------------------------------------------------------------------------
-- 6. Recreate enums without their email-only members
-- ---------------------------------------------------------------------------

create type public.application_source_new as enum ('EXTENSION', 'MANUAL');
alter table public.applications
  alter column source type public.application_source_new
  using source::text::public.application_source_new;
drop type public.application_source;
alter type public.application_source_new rename to application_source;

create type public.event_source_new as enum ('EXTENSION', 'MANUAL', 'SYSTEM');
alter table public.application_events
  alter column source type public.event_source_new
  using source::text::public.event_source_new;
drop type public.event_source;
alter type public.event_source_new rename to event_source;

create type public.application_event_type_new as enum (
  'JD_SAVED', 'MARKED_AS_APPLIED', 'APPLICATION_WITHDRAWN',
  'GENERAL_UPDATE', 'MANUAL_CORRECTION'
);
alter table public.application_events
  alter column event_type type public.application_event_type_new
  using event_type::text::public.application_event_type_new;
drop type public.application_event_type;
alter type public.application_event_type_new rename to application_event_type;

grant usage on type public.application_source, public.event_source,
  public.application_event_type
  to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Inbound-email storage bucket
-- ---------------------------------------------------------------------------

-- Supabase blocks direct deletes on storage tables. Empty and delete the
-- 'inbound-emails' bucket through the Storage API or dashboard instead.
