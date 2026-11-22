-- Keep case and repeated parameter values when the URL identifies the posting.
-- The previous normalization could reuse another role and skip saving this one.
create or replace function public.normalize_posting_url(p_url text)
returns text
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  v_url text := trim(coalesce(p_url, ''));
  v_fragment text;
  v_query text;
  v_host text;
  v_path text;
  v_id text[];
  v_kept text;
begin
  if v_url !~* '^https?://' then
    return null;
  end if;

  v_url := regexp_replace(v_url, '^https?://', '', 'i');

  -- Hash routes name a page. Other fragments mark a scroll position.
  v_fragment := substring(v_url from '#(!?/.*)$');
  v_url := regexp_replace(v_url, '#.*$', '');
  v_query := coalesce(substring(v_url from '\?(.*)$'), '');
  v_url := regexp_replace(v_url, '\?.*$', '');
  v_host := split_part(v_url, '/', 1);
  v_path := regexp_replace(substr(v_url, char_length(v_host) + 1), '/+$', '');
  v_host := regexp_replace(lower(v_host), '^www\.', '');

  if v_host = '' then
    return null;
  end if;

  -- Keep the established aliases for recognized LinkedIn and Indeed job IDs.
  if v_host ~ '(^|\.)linkedin\.com$' then
    v_id := regexp_match(lower(v_path), '^/jobs/view/(?:[^/]*-)?([0-9]+)$');
    if v_id is null then
      v_id := regexp_match(lower(v_query), '(?:^|&)currentjobid=([0-9]+)');
    end if;
    if v_id is not null then
      return 'linkedin.com/jobs/view/' || v_id[1];
    end if;
  elsif v_host ~ '(^|\.)indeed\.[a-z.]+$' then
    v_id := regexp_match(lower(v_query), '(?:^|&)v?jk=([0-9a-f]+)');
    if v_id is not null then
      return 'indeed.com/viewjob?jk=' || v_id[1];
    end if;
  end if;

  -- Canonicalize the order of distinct keys, keeping each repeated key's value
  -- order. Case folding here is only for sorting and recognizing tracking keys.
  select string_agg(parameter, '&' order by parameter_name collate "C", ordinal)
  into v_kept
  from (
    select parameter, ordinal, lower(split_part(parameter, '=', 1)) as parameter_name
    from unnest(string_to_array(v_query, '&')) with ordinality as entries(parameter, ordinal)
    where parameter <> ''
  ) as parameters
  where parameter_name !~ (
    '^(utm_.*|hsa_.*|gclid|gclsrc|dclid|fbclid|msclkid|ttclid|twclid|yclid|igshid|li_fat_id'
    || '|mc_cid|mc_eid|_ga|_gl|_hsenc|_hsmi|gh_src|lever-source|lever-origin|lever-via|ashby_src'
    || '|source|src|sourceid|source_id|referrer|referer|ref_src|refid|trk|trkinfo|trackingid'
    || '|tracking_id|campaign|campaignid|medium|channel|sessionid|jsessionid|lang|locale|hl)$'
    )
    -- A ref such as JR123 can identify the job itself.
    and not (parameter_name = 'ref' and split_part(parameter, '=', 2) !~ '[0-9]');

  return v_host || v_path
    || coalesce('?' || v_kept, '')
    || coalesce('#' || v_fragment, '');
end;
$$;

comment on function public.normalize_posting_url(text) is
  'Reduces a posting URL to the parts that identify the job, preserving case in generic paths, retained query parameters, and hash routes.';

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
  v_url text := nullif(trim(coalesce(p_original_url, '')), '');
  v_company text := public.normalize_company_name(p_company);
  v_job_id text := nullif(lower(trim(coalesce(p_job_id, ''))), '');
  v_posting_url text;
begin
  if v_url is not null and v_url ~* '^https?://' then
    select * into v_identity from public.ats_identity(v_url);

    if v_identity.provider is not null
      and v_identity.tenant is not null
      and v_identity.job_id is not null
    then
      return 'ats:' || v_identity.provider || ':' || v_identity.tenant || ':' || lower(v_identity.job_id);
    end if;

    -- A requisition number outranks the URL because one job can have many URLs.
    if v_job_id ~ '[0-9]' and v_company is not null then
      return 'job:' || v_company || ':' || v_job_id;
    end if;

    v_posting_url := public.normalize_posting_url(v_url);
    if v_posting_url is not null then
      return 'url:' || v_posting_url;
    end if;
  end if;

  -- A requisition number is only unique inside an employer.
  if v_job_id is not null and v_company is not null then
    return 'job:' || v_company || ':' || v_job_id;
  end if;

  return null;
end;
$$;

-- Recalculate saved URL keys without changing role order or merging records.
drop index public.applications_user_identity_idx;
alter table public.applications disable trigger applications_set_updated_at;

update public.applications
set identity_key = public.application_identity_key(original_url, company, job_id)
where identity_key like 'url:%'
  and identity_key is distinct from public.application_identity_key(original_url, company, job_id);

alter table public.applications enable trigger applications_set_updated_at;
create unique index applications_user_identity_idx
  on public.applications(user_id, identity_key)
  where identity_key is not null;

-- PostgreSQL does not refresh expression index entries when a function changes.
reindex index public.applications_user_posting_url_idx;
