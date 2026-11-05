-- Stop treating different postings as one application.
--
-- The posting identity used to drop the whole query string, so
-- careers.example.com/job?id=1 and ?id=2 shared a key and the second job was
-- never saved. It also ignored the employer's job ID whenever a URL existed,
-- so one requisition reached through two URLs counted as two postings.
--
-- A missed duplicate can be merged from the dashboard, but a false duplicate
-- loses the job. Unknown query parameters are therefore kept, and only known
-- attribution parameters are removed.

-- ---------------------------------------------------------------------------
-- URL identity
-- ---------------------------------------------------------------------------

create or replace function public.normalize_posting_url(p_url text)
returns text
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  v_url text := lower(trim(coalesce(p_url, '')));
  v_fragment text;
  v_query text;
  v_host text;
  v_path text;
  v_id text[];
  v_kept text;
begin
  if v_url !~ '^https?://' then
    return null;
  end if;

  v_url := regexp_replace(v_url, '^https?://(www\.)?', '');

  -- A hash route such as #/jobs/123 names the page. Any other fragment is only
  -- a scroll position.
  v_fragment := substring(v_url from '#(!?/.*)$');
  v_url := regexp_replace(v_url, '#.*$', '');

  v_query := coalesce(substring(v_url from '\?(.*)$'), '');
  v_url := regexp_replace(v_url, '\?.*$', '');
  v_host := split_part(v_url, '/', 1);
  v_path := regexp_replace(substr(v_url, char_length(v_host) + 1), '/+$', '');

  if v_host = '' then
    return null;
  end if;

  -- Job boards show the same posting under many URLs, including a search page
  -- with the selected job in the query string.
  if v_host ~ '(^|\.)linkedin\.com$' then
    v_id := regexp_match(v_path, '^/jobs/view/(?:[^/]*-)?([0-9]+)$');
    if v_id is null then
      v_id := regexp_match(v_query, '(?:^|&)currentjobid=([0-9]+)');
    end if;
    if v_id is not null then
      return 'linkedin.com/jobs/view/' || v_id[1];
    end if;
  elsif v_host ~ '(^|\.)indeed\.[a-z.]+$' then
    v_id := regexp_match(v_query, '(?:^|&)v?jk=([0-9a-f]+)');
    if v_id is not null then
      return 'indeed.com/viewjob?jk=' || v_id[1];
    end if;
  end if;

  -- Parameters are sorted so their order cannot change the key.
  select string_agg(parameter, '&' order by parameter) into v_kept
  from unnest(string_to_array(v_query, '&')) as parameter
  where parameter <> ''
    and split_part(parameter, '=', 1) !~ (
      '^(utm_.*|hsa_.*|gclid|gclsrc|dclid|fbclid|msclkid|ttclid|twclid|yclid|igshid|li_fat_id'
      || '|mc_cid|mc_eid|_ga|_gl|_hsenc|_hsmi|gh_src|lever-source|lever-origin|lever-via|ashby_src'
      || '|source|src|sourceid|source_id|referrer|referer|ref_src|refid|trk|trkinfo|trackingid'
      || '|tracking_id|campaign|campaignid|medium|channel|sessionid|jsessionid|lang|locale|hl)$'
    )
    -- "ref=linkedin" is attribution, but "ref=JR123" can be the job itself.
    and not (split_part(parameter, '=', 1) = 'ref' and split_part(parameter, '=', 2) !~ '[0-9]');

  return v_host || v_path
    || coalesce('?' || v_kept, '')
    || coalesce('#' || v_fragment, '');
end;
$$;

comment on function public.normalize_posting_url(text) is
  'Reduces a posting URL to the parts that identify the job. Keeps unknown query parameters, because a false duplicate loses a job.';

-- ---------------------------------------------------------------------------
-- Posting identity
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
  v_company text := public.normalize_company_name(p_company);
  v_job_id text := nullif(lower(trim(coalesce(p_job_id, ''))), '');
  v_posting_url text;
begin
  if v_url is not null and v_url ~ '^https?://' then
    select * into v_identity from public.ats_identity(v_url);

    if v_identity.provider is not null
      and v_identity.tenant is not null
      and v_identity.job_id is not null
    then
      return 'ats:' || v_identity.provider || ':' || v_identity.tenant || ':' || lower(v_identity.job_id);
    end if;

    -- The employer's job ID outranks the URL, because one requisition can be
    -- reached through several URLs. Requisition numbers contain a digit, so a
    -- value without one is more likely a department or company label that
    -- every posting on the site shares.
    if v_job_id ~ '[0-9]' and v_company is not null then
      return 'job:' || v_company || ':' || v_job_id;
    end if;

    v_posting_url := public.normalize_posting_url(v_url);
    if v_posting_url is not null then
      return 'url:' || v_posting_url;
    end if;
  end if;

  -- A requisition number is only unique inside an employer. Never deduplicate
  -- on a bare requisition number because employers reuse them.
  if v_job_id is not null and v_company is not null then
    return 'job:' || v_company || ':' || v_job_id;
  end if;

  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Recalculate saved applications
-- ---------------------------------------------------------------------------

-- Two saved applications can now share a key, such as one requisition saved
-- from two URLs, so uniqueness is enforced again only after merging them.
drop index public.applications_user_identity_idx;

update public.applications
set identity_key = public.application_identity_key(original_url, company, job_id)
where identity_key is distinct from public.application_identity_key(original_url, company, job_id);

-- The winner favors real pipeline progress, then attached documents and
-- history, then the most recently updated record. The merge moves every
-- related record to the winner.
do $$
declare
  v_group record;
  v_merge_id uuid;
begin
  for v_group in
    select
      grouped.user_id,
      array_agg(
        grouped.id
        order by
          public.application_status_rank(grouped.status) desc,
          grouped.complete_document_count desc,
          grouped.event_count desc,
          grouped.updated_at desc,
          grouped.created_at desc,
          grouped.id
      ) as application_ids
    from (
      select
        applications.*,
        (select count(*) from public.documents
          where documents.application_id = applications.id
            and documents.capture_status = 'COMPLETE') as complete_document_count,
        (select count(*) from public.application_events
          where application_events.application_id = applications.id) as event_count
      from public.applications
      where applications.identity_key is not null
    ) grouped
    group by grouped.user_id, grouped.identity_key
    having count(*) > 1
  loop
    foreach v_merge_id in array v_group.application_ids[2:array_length(v_group.application_ids, 1)]
    loop
      perform public._merge_application_records(v_group.application_ids[1], v_merge_id, v_group.user_id);
    end loop;
  end loop;
end;
$$;

create unique index applications_user_identity_idx
  on public.applications(user_id, identity_key)
  where identity_key is not null;
