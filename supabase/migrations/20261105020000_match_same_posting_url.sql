-- Treat the same web address as the same posting, even when the identity keys
-- differ.
--
-- A posting's identity key prefers the employer's job ID over its URL. So a role
-- saved with a job ID got a job-based key, and adding the same URL without one
-- produced a URL-based key that did not match, creating a duplicate. Renaming a
-- company had the same effect, because job-based keys include the company.
--
-- The unique index on identity_key stays as it is. This only widens the lookup
-- that runs before a role is created.

create index applications_user_posting_url_idx
  on public.applications(user_id, public.normalize_posting_url(original_url));

-- Same URL counts as the same posting unless both sides have different job IDs,
-- since one URL can show several jobs. If several roles share the URL there is no
-- telling which is meant, and a false match loses a job, so none is returned.
create function public.find_matching_application(
  p_user_id uuid,
  p_original_url text,
  p_company text,
  p_job_id text
)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_identity_key text := public.application_identity_key(p_original_url, p_company, p_job_id);
  v_posting_url text := public.normalize_posting_url(p_original_url);
  v_job_id text := nullif(lower(trim(coalesce(p_job_id, ''))), '');
  v_match uuid;
  v_candidates uuid[];
begin
  if v_identity_key is not null then
    select applications.id into v_match
    from public.applications
    where applications.user_id = p_user_id
      and applications.identity_key = v_identity_key;

    if v_match is not null then
      return v_match;
    end if;
  end if;

  if v_posting_url is null then
    return null;
  end if;

  select array_agg(candidates.id) into v_candidates
  from (
    select applications.id
    from public.applications
    where applications.user_id = p_user_id
      and public.normalize_posting_url(applications.original_url) = v_posting_url
      and (
        v_job_id is null
        or nullif(lower(trim(coalesce(applications.job_id, ''))), '') is null
        or lower(trim(applications.job_id)) = v_job_id
      )
    limit 2
  ) candidates;

  return case when array_length(v_candidates, 1) = 1 then v_candidates[1] end;
end;
$$;

comment on function public.find_matching_application(uuid, text, text, text) is
  'Finds the role a new save belongs to: by identity key, then by URL when no job ID conflicts.';

revoke all on function public.find_matching_application(uuid, text, text, text) from public, anon, authenticated;

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
  select public.find_matching_application(auth.uid(), p_original_url, p_company, p_job_id);
$$;

create or replace function public.create_capture_session(
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
  application_reused boolean,
  application_company text,
  application_position text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_job_id uuid;
  v_job_status public.capture_status;
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

  if v_job_id is null then
    v_application_id := public.find_matching_application(v_user_id, p_original_url, p_company, p_job_id);

    if v_application_id is not null then
      v_reused := true;

      perform 1
      from public.applications
      where applications.id = v_application_id
      for update;

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
  end if;

  if v_job_id is null then
    -- A reused manual application may not have a saved job description yet.
    -- Attach its first capture directly to that existing application.
    v_job_id := gen_random_uuid();
    v_document_id := gen_random_uuid();
    v_temporary_storage_path :=
      v_user_id::text || '/' || v_application_id::text || '/' || v_document_id::text || '.mhtml';
    v_output_storage_path :=
      v_user_id::text || '/' || v_application_id::text || '/job-description-' || v_document_id::text || '.pdf';
    v_job_status := 'PENDING';

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
  else
    select capture_jobs.status into v_job_status
    from public.capture_jobs
    where capture_jobs.id = v_job_id;

    -- Retention clears the path of a failed capture once its file expires. The
    -- user can still capture the page again, so give the session its path back.
    if v_job_status = 'FAILED' and v_temporary_storage_path is null then
      v_temporary_storage_path :=
        v_user_id::text || '/' || v_application_id::text || '/' || v_document_id::text || '.mhtml';

      update public.documents
      set temporary_storage_path = v_temporary_storage_path
      where documents.id = v_document_id and documents.user_id = v_user_id;
    end if;
  end if;

  return query
  select
    v_job_id, v_application_id, v_document_id,
    v_temporary_storage_path, v_output_storage_path,
    v_job_status, v_reused,
    applications.company, applications.position
  from public.applications
  where applications.id = v_application_id;
end;
$$;
