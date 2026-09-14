-- One tracked posting should produce one application per user.
--
-- Capture idempotency prevents a single interrupted upload from inserting
-- twice, but a fresh extension popup has a fresh idempotency key. This adds a
-- durable posting identity, consolidates existing exact duplicates without
-- losing their related records, and makes future captures reuse the existing
-- application.

-- ---------------------------------------------------------------------------
-- Stable posting identity
-- ---------------------------------------------------------------------------

create or replace function public.application_identity_key(
  p_original_url text,
  p_company text,
  p_job_id text
)
returns text
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  v_identity record;
  v_url text := nullif(lower(trim(coalesce(p_original_url, ''))), '');
  v_company text;
  v_job_id text := nullif(lower(trim(coalesce(p_job_id, ''))), '');
begin
  if v_url is not null and v_url ~ '^https?://' then
    select * into v_identity from public.ats_identity(v_url);

    if v_identity.provider is not null
      and v_identity.tenant is not null
      and v_identity.job_id is not null
    then
      return 'ats:' || v_identity.provider || ':' || v_identity.tenant || ':' || lower(v_identity.job_id);
    end if;

    -- Query strings and fragments normally contain attribution rather than
    -- posting identity. ATS-hosted identifiers were retained by the stronger
    -- branch above before these parts were removed.
    v_url := regexp_replace(v_url, '[#?].*$', '');
    v_url := regexp_replace(v_url, '^https?://(www\.)?', '');
    v_url := regexp_replace(v_url, '/+$', '');
    if v_url <> '' then
      return 'url:' || v_url;
    end if;
  end if;

  -- A manually entered requisition is only unique inside an employer. Never
  -- deduplicate on a bare requisition number because employers reuse them.
  if v_job_id is not null then
    v_company := public.normalize_company_name(p_company);
    if v_company is not null then
      return 'job:' || v_company || ':' || v_job_id;
    end if;
  end if;

  return null;
end;
$$;

comment on function public.application_identity_key(text, text, text) is
  'Stable per-posting identity used to prevent exact duplicate applications.';

alter table public.applications
  add column identity_key text;

comment on column public.applications.identity_key is
  'Trigger-derived posting identity. Unique per user when sufficient URL or requisition evidence exists.';

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

  new.company_tokens := public.company_search_tokens(new.company, new.ats_tenant);
  new.identity_key := public.application_identity_key(new.original_url, new.company, new.job_id);

  return new;
end;
$$;

drop trigger if exists applications_normalize_before_write on public.applications;
create trigger applications_normalize_before_write
before insert or update of company, position, original_url, job_id
on public.applications
for each row execute function public.normalize_application_fields();

-- Populate identity_key for applications saved before this migration.
update public.applications set company = company;

-- ---------------------------------------------------------------------------
-- Lossless merge primitive
-- ---------------------------------------------------------------------------

create or replace function public.application_status_rank(p_status public.application_status)
returns integer
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case p_status
    when 'SAVED' then 0
    when 'NEEDS_REVIEW' then 0
    when 'APPLIED' then 1
    when 'ASSESSMENT' then 2
    when 'INTERVIEW' then 3
    when 'OFFER' then 4
    when 'REJECTED' then 4
    when 'WITHDRAWN' then 4
  end;
$$;

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

  update public.email_events
  set application_id = v_keep.id
  where application_id = v_merge.id;

  update public.application_events
  set application_id = v_keep.id
  where application_id = v_merge.id;

  -- Suggested IDs are arrays rather than foreign keys. Replace the old ID,
  -- retain the original ranking, and remove any duplicate target occurrence.
  update public.review_tasks
  set suggested_application_ids = coalesce((
    select array_agg(candidate_id order by first_position)
    from (
      select
        case when suggestion.application_id = v_merge.id then v_keep.id else suggestion.application_id end as candidate_id,
        min(suggestion.position) as first_position
      from unnest(review_tasks.suggested_application_ids) with ordinality
        as suggestion(application_id, position)
      group by case when suggestion.application_id = v_merge.id then v_keep.id else suggestion.application_id end
    ) ranked
  ), array[]::uuid[])
  where v_merge.id = any(suggested_application_ids);

  delete from public.applications where id = v_merge.id;

  insert into public.application_events (
    application_id, user_id, event_type, event_time, source, evidence,
    previous_status, new_status
  )
  select
    v_keep.id, p_user_id, 'MANUAL_CORRECTION', now(), 'SYSTEM',
    'Exact duplicate application consolidated; linked documents, email, and timeline history were preserved.',
    applications.status, applications.status
  from public.applications
  where id = v_keep.id;

  return v_keep.id;
end;
$$;

revoke all on function public._merge_application_records(uuid, uuid, uuid) from public;

-- Consolidate existing exact duplicates before enforcing uniqueness. The
-- winner favors real pipeline progress, then attached email/doc evidence,
-- then the most recently updated record.
do $$
declare
  v_group record;
  v_keep_id uuid;
  v_merge_id uuid;
begin
  for v_group in
    select
      grouped.user_id,
      grouped.identity_key,
      array_agg(
        grouped.id
        order by
          public.application_status_rank(grouped.status) desc,
          grouped.email_count desc,
          grouped.complete_document_count desc,
          grouped.event_count desc,
          grouped.updated_at desc,
          grouped.created_at desc,
          grouped.id
      ) as application_ids
    from (
      select
        applications.*,
        (select count(*) from public.email_events where email_events.application_id = applications.id) as email_count,
        (select count(*) from public.documents where documents.application_id = applications.id and documents.capture_status = 'COMPLETE') as complete_document_count,
        (select count(*) from public.application_events where application_events.application_id = applications.id) as event_count
      from public.applications
      where applications.identity_key is not null
    ) grouped
    group by grouped.user_id, grouped.identity_key
    having count(*) > 1
  loop
    v_keep_id := v_group.application_ids[1];
    foreach v_merge_id in array v_group.application_ids[2:array_length(v_group.application_ids, 1)]
    loop
      perform public._merge_application_records(v_keep_id, v_merge_id, v_group.user_id);
    end loop;
  end loop;
end;
$$;

create unique index applications_user_identity_idx
  on public.applications(user_id, identity_key)
  where identity_key is not null;

-- ---------------------------------------------------------------------------
-- Authenticated lookup and explicit merge
-- ---------------------------------------------------------------------------

create or replace function public.find_existing_application(
  p_original_url text,
  p_company text,
  p_job_id text default null
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select applications.id
  from public.applications
  where applications.user_id = auth.uid()
    and applications.identity_key = public.application_identity_key(p_original_url, p_company, p_job_id)
    and applications.identity_key is not null
  limit 1;
$$;

create or replace function public.merge_duplicate_applications(
  p_keep_application_id uuid,
  p_merge_application_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  return public._merge_application_records(
    p_keep_application_id,
    p_merge_application_id,
    v_user_id
  );
end;
$$;

revoke all on function public.find_existing_application(text, text, text) from public;
revoke all on function public.merge_duplicate_applications(uuid, uuid) from public;
grant execute on function public.find_existing_application(text, text, text) to authenticated;
grant execute on function public.merge_duplicate_applications(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Capture reuses an exact existing posting
-- ---------------------------------------------------------------------------

drop function if exists public.create_capture_session(text, text, text, timestamptz, uuid, text);

create function public.create_capture_session(
  p_company text,
  p_position text,
  p_original_url text,
  p_captured_at timestamptz,
  p_idempotency_key uuid,
  p_job_id text default null
)
returns table (
  job_id uuid,
  application_id uuid,
  document_id uuid,
  temporary_storage_path text,
  output_storage_path text,
  capture_status public.capture_status,
  application_reused boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_job_id uuid;
  v_application_id uuid;
  v_document_id uuid;
  v_temporary_storage_path text;
  v_output_storage_path text;
  v_identity_key text;
  v_reused boolean := false;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  p_company := trim(p_company);
  p_position := trim(p_position);
  p_original_url := trim(p_original_url);
  p_job_id := nullif(trim(coalesce(p_job_id, '')), '');

  if char_length(p_company) not between 1 and 200 then
    raise exception 'Company must contain 1 to 200 characters';
  end if;
  if char_length(p_position) not between 1 and 300 then
    raise exception 'Position must contain 1 to 300 characters';
  end if;
  if p_original_url !~* '^https?://' then
    raise exception 'Original URL must use HTTP or HTTPS';
  end if;
  if p_captured_at is null then
    raise exception 'Capture time is required';
  end if;
  if p_job_id is not null and char_length(p_job_id) > 100 then
    raise exception 'Job ID must contain at most 100 characters';
  end if;

  v_identity_key := public.application_identity_key(p_original_url, p_company, p_job_id);

  -- Serialize all captures of the same posting, even when separate popup
  -- sessions generated different idempotency keys.
  perform pg_advisory_xact_lock(hashtextextended(
    v_user_id::text || ':' || coalesce(v_identity_key, p_idempotency_key::text), 0
  ));

  select
    capture_jobs.id,
    capture_jobs.application_id,
    capture_jobs.document_id,
    documents.temporary_storage_path,
    documents.storage_path
  into
    v_job_id,
    v_application_id,
    v_document_id,
    v_temporary_storage_path,
    v_output_storage_path
  from public.capture_jobs
  join public.documents on documents.id = capture_jobs.document_id
  where capture_jobs.user_id = v_user_id
    and capture_jobs.idempotency_key = p_idempotency_key;

  if v_job_id is not null then
    return query select
      v_job_id, v_application_id, v_document_id,
      v_temporary_storage_path, v_output_storage_path,
      (select status from public.capture_jobs where id = v_job_id), false;
    return;
  end if;

  if v_identity_key is not null then
    select applications.id into v_application_id
    from public.applications
    where applications.user_id = v_user_id
      and applications.identity_key = v_identity_key
    for update;
  end if;

  if v_application_id is not null then
    v_reused := true;

    -- Prefer a completed capture; otherwise return the latest recoverable
    -- session. The extension knows how to resume PENDING/FAILED sessions.
    select
      capture_jobs.id,
      capture_jobs.document_id,
      documents.temporary_storage_path,
      documents.storage_path
    into
      v_job_id,
      v_document_id,
      v_temporary_storage_path,
      v_output_storage_path
    from public.capture_jobs
    join public.documents on documents.id = capture_jobs.document_id
    where capture_jobs.application_id = v_application_id
      and capture_jobs.user_id = v_user_id
    order by
      case capture_jobs.status when 'COMPLETE' then 0 when 'PROCESSING' then 1 when 'PENDING' then 2 else 3 end,
      capture_jobs.created_at desc
    limit 1;

    if v_job_id is not null then
      return query select
        v_job_id, v_application_id, v_document_id,
        v_temporary_storage_path, v_output_storage_path,
        (select status from public.capture_jobs where id = v_job_id), true;
      return;
    end if;
  else
    v_application_id := gen_random_uuid();

    insert into public.applications (
      id, user_id, company, company_normalized, position, position_normalized,
      status, source, original_url, job_id
    ) values (
      v_application_id, v_user_id, p_company, '', p_position, '',
      'SAVED', 'EXTENSION', p_original_url, p_job_id
    );
  end if;

  -- A reused manual/email application may not have a saved job description
  -- yet. Attach its first capture directly to that existing application.
  v_job_id := gen_random_uuid();
  v_document_id := gen_random_uuid();
  v_temporary_storage_path :=
    v_user_id::text || '/' || v_application_id::text || '/' || v_document_id::text || '.mhtml';
  v_output_storage_path :=
    v_user_id::text || '/' || v_application_id::text || '/job-description-' || v_document_id::text || '.pdf';

  insert into public.documents (
    id, application_id, user_id, storage_path, temporary_storage_path,
    original_url, capture_status, captured_at
  ) values (
    v_document_id, v_application_id, v_user_id, v_output_storage_path,
    v_temporary_storage_path, p_original_url, 'PENDING', p_captured_at
  );

  insert into public.capture_jobs (
    id, user_id, application_id, document_id, idempotency_key, status
  ) values (
    v_job_id, v_user_id, v_application_id, v_document_id, p_idempotency_key, 'PENDING'
  );

  return query select
    v_job_id, v_application_id, v_document_id,
    v_temporary_storage_path, v_output_storage_path,
    'PENDING'::public.capture_status, v_reused;
end;
$$;

revoke all on function public.create_capture_session(text, text, text, timestamptz, uuid, text) from public;
grant execute on function public.create_capture_session(text, text, text, timestamptz, uuid, text) to authenticated;
