-- Different jobs must not share a key.
--
-- ats_identity read the wrong part of some job board URLs, so different jobs got
-- one key and the second save reused the first job's role. That job was then
-- lost, because nothing recorded the page the person was actually on.
--
--   Workday          An apply page or trailing slash gave the location, not the
--                    requisition, so jobs in one city collided. The job page and
--                    its own apply page also failed to match.
--   Greenhouse       Embedded forms gave "embed" and "ob_app" for every employer.
--   SmartRecruiters  One-click forms gave "oneclick-ui" and "company" for every
--                    employer.
--   BambooHR         view.php gave "view" for every job at an employer.
--
-- Route nouns also matched without a following slash, which cut the first letter
-- off IDs such as "product-manager".

create or replace function public.ats_identity(p_url text)
returns table (provider text, tenant text, job_id text)
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  v_url text := lower(coalesce(p_url, ''));
  v_host text;
  v_path text;
  v_query text;
  v_match text[];
  v_labels text[];
  v_count integer;
  v_index integer;

  -- Boards that put the employer in the first path segment, as in
  -- jobs.gem.com/obin-ai/<id> or apply.workable.com/acme/j/<id>.
  c_path_boards constant text[] := array[
    'greenhouse.io', 'ashbyhq.com', 'lever.co', 'smartrecruiters.com',
    'gem.com', 'workable.com', 'rippling.com', 'jobvite.com', 'dover.com'
  ];
  -- Boards that put the employer in the subdomain, as in
  -- acme.breezy.hr or acme.recruitee.com.
  c_subdomain_boards constant text[] := array[
    'myworkdayjobs.com', 'icims.com', 'breezy.hr', 'teamtailor.com',
    'recruitee.com', 'bamboohr.com', 'applytojob.com'
  ];
  -- Words from vendor routes. As an ID, one would give every page on that route
  -- the same key, and a missed duplicate is safer than a false one.
  c_route_words constant text[] := array[
    'application', 'apply', 'careers', 'departments', 'embed', 'intro', 'job',
    'jobs', 'list', 'login', 'offices', 'search', 'view'
  ];
  v_board text;
begin
  provider := null;
  tenant := null;
  job_id := null;

  if v_url !~ '^https?://' then
    return next;
    return;
  end if;

  v_host := split_part(split_part(regexp_replace(v_url, '^https?://', ''), '/', 1), '?', 1);
  v_host := regexp_replace(v_host, ':[0-9]+$', '');
  v_path := '/' || coalesce(split_part(split_part(regexp_replace(v_url, '^https?://[^/]*', ''), '?', 1), '#', 1), '');
  v_path := regexp_replace(v_path, '^/+', '/');
  v_query := coalesce(nullif(split_part(v_url, '?', 2), ''), '');

  -- Tenant in the first path segment.
  foreach v_board in array c_path_boards loop
    if v_host = v_board or v_host like ('%.' || v_board) then
      -- The host label and the vendor's name differ for some boards, and the
      -- query-string branch below names the same vendors. Both paths must
      -- agree or one employer appears under two providers.
      provider := case split_part(v_board, '.', 1)
        when 'ashbyhq' then 'ashby'
        else split_part(v_board, '.', 1)
      end;

      -- Greenhouse's embedded form keeps the employer and job in its query, and
      -- they are the same values as in the hosted page's path.
      if v_board = 'greenhouse.io' and v_path ~ '^/embed(/|$)' then
        tenant := (regexp_match(v_query, '(?:^|&)for=([a-z0-9][a-z0-9._-]*)'))[1];
        job_id := (regexp_match(v_query, '(?:^|&)token=([0-9]+)'))[1];
        return next;
        return;
      end if;

      -- SmartRecruiters' one-click form has its own path layout.
      if v_board = 'smartrecruiters.com' and v_path ~ '^/oneclick-ui(/|$)' then
        v_match := regexp_match(v_path, '^/oneclick-ui/company/([a-z0-9][a-z0-9._-]*)/publication/([a-z0-9][a-z0-9-]{2,})');
        if v_match is not null then
          tenant := v_match[1];
          job_id := v_match[2];
        end if;
        return next;
        return;
      end if;

      -- The segment after the tenant is the posting, under whatever noun the
      -- vendor uses ("jobs", "j", "o") or none at all. The noun is a whole
      -- segment, so it cannot match the start of an ID.
      v_match := regexp_match(v_path, '^/([a-z0-9][a-z0-9._-]*)(?:/(?:(?:jobs?|j|o|p)(?:/|$))?)?([a-z0-9][a-z0-9._~-]{2,})?');
      if v_match is not null then
        tenant := v_match[1];
        job_id := v_match[2];
      end if;
      -- A segment that is only a vendor route word is not an employer.
      if tenant in ('jobs', 'job', 'careers', 'search', 'company', 'companies', 'apply', 'embed') then
        tenant := null;
      end if;
      if job_id = any(c_route_words) then
        job_id := null;
      end if;
      return next;
      return;
    end if;
  end loop;

  -- Tenant in the subdomain.
  foreach v_board in array c_subdomain_boards loop
    if v_host like ('%.' || v_board) then
      provider := split_part(v_board, '.', 1);
      if v_board = 'myworkdayjobs.com' then
        provider := 'workday';
      end if;
      tenant := nullif(split_part(v_host, '.', 1), '');
      if tenant in ('www', 'jobs', 'careers', 'apply', 'ats', 'app') then
        tenant := null;
      end if;

      if v_board = 'myworkdayjobs.com' then
        -- The requisition ID trails the title after an underscore, and pages
        -- such as /apply can follow it. The segment before the title is a
        -- location that many jobs share, so there is no fallback to a segment:
        -- with no requisition ID, the URL identifies the posting instead.
        v_match := regexp_match(
          substring(v_path from '/(?:job|details)/(.*)$'),
          '_([a-z0-9-]*[0-9][a-z0-9-]*)(?:/[^_]*)?$'
        );
        if v_match is null then
          v_match := regexp_match(v_path, '_([a-z0-9-]*[0-9][a-z0-9-]*)$');
        end if;
      else
        -- Requisition IDs trail the title after an underscore and always
        -- contain a digit, but may lead with hyphenated letters.
        v_match := regexp_match(v_path, '_([a-z0-9-]*[0-9][a-z0-9-]*)$');
        if v_match is null then
          -- An ID is a whole segment, which rules out a file name like view.php.
          v_match := regexp_match(v_path, '/(?:jobs?|p|o)/([a-z0-9][a-z0-9-]{2,})(?:/|$)');
        end if;
      end if;

      if v_match is not null and not (v_match[1] = any(c_route_words)) then
        job_id := v_match[1];
      end if;
      return next;
      return;
    end if;
  end loop;

  -- Embedded boards on an employer's own domain keep the ATS job ID in the
  -- query string. The tenant is not present, so the host supplies the token.
  v_match := regexp_match(v_query, '(?:^|&)gh_jid=([0-9]+)');
  if v_match is not null then
    provider := 'greenhouse';
    job_id := v_match[1];
  else
    v_match := regexp_match(v_query, '(?:^|&)ashby_jid=([0-9a-f-]{8,})');
    if v_match is not null then
      provider := 'ashby';
      job_id := v_match[1];
    else
      v_match := regexp_match(v_query, '(?:^|&)lever_jid=([0-9a-f-]{8,})');
      if v_match is not null then
        provider := 'lever';
        job_id := v_match[1];
      end if;
    end if;
  end if;

  -- Employer-hosted posting: the registrable label identifies the company.
  -- Take the label below the public suffix rather than the first label, so
  -- "careers.northwind.com" yields "northwind" and not "careers".
  v_labels := string_to_array(v_host, '.');
  v_count := array_length(v_labels, 1);
  if v_count is null or v_count < 2 then
    tenant := null;
  else
    v_index := v_count - 1;
    -- Two-part public suffixes such as "co.uk" push the registrable label
    -- one position further left.
    if char_length(v_labels[v_count]) = 2
      and v_labels[v_count - 1] in ('co', 'com', 'org', 'net', 'gov', 'ac', 'edu')
      and v_count >= 3
    then
      v_index := v_count - 2;
    end if;
    tenant := nullif(regexp_replace(v_labels[v_index], '[^a-z0-9]+', '', 'g'), '');
  end if;

  if tenant is not null and char_length(tenant) < 3 then
    tenant := null;
  end if;

  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- Recalculate saved applications
-- ---------------------------------------------------------------------------

-- Two saved applications can now share a key, such as a Workday job page and its
-- apply page, so uniqueness is enforced again only after merging them.
drop index public.applications_user_identity_idx;

-- Correcting a key is not an edit, so it must not change a role's Updated date
-- or move it up the list. The merges below are real changes and do count.
alter table public.applications disable trigger applications_set_updated_at;

update public.applications as application
set ats_provider = parsed.provider,
    ats_tenant = parsed.tenant,
    ats_job_id = parsed.job_id,
    identity_key = public.application_identity_key(existing.original_url, existing.company, existing.job_id)
from public.applications as existing
cross join lateral public.ats_identity(existing.original_url) as parsed
where application.id = existing.id
  and existing.original_url is not null
  and (existing.ats_provider, existing.ats_tenant, existing.ats_job_id, existing.identity_key)
    is distinct from (
      parsed.provider, parsed.tenant, parsed.job_id,
      public.application_identity_key(existing.original_url, existing.company, existing.job_id)
    );

alter table public.applications enable trigger applications_set_updated_at;

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
