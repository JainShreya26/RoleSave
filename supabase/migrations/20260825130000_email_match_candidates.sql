-- Candidate retrieval for inbound email.
--
-- Replaces "fetch every application for the user and score them in Node" with
-- one indexed query that narrows to applications the message actually refers
-- to, and reports the evidence for each.
--
-- This function deliberately returns facts rather than a verdict. Scoring and
-- the auto-match decision live in the worker, where they are cheap to unit
-- test; the parts that benefit from an index -- token overlap and trigram
-- similarity -- stay in the database.

create function public.match_email_candidates(
  p_user_id uuid,
  p_tokens text[] default array[]::text[],
  p_company_mentions text[] default array[]::text[],
  p_job_id_mentions text[] default array[]::text[],
  p_link_urls text[] default array[]::text[],
  p_received_at timestamptz default now(),
  p_thread_application_id uuid default null
)
returns table (
  application_id uuid,
  company text,
  job_position text,
  status public.application_status,
  matched_thread boolean,
  matched_job_id boolean,
  matched_tenant boolean,
  company_exact boolean,
  company_similarity real,
  company_conflict boolean,
  matched_tokens text[],
  days_apart real
)
language sql
stable
security invoker
-- similarity() comes from pg_trgm. The foundation migration created the
-- extension without pinning a schema, so both likely homes are on the path;
-- everything this function owns stays explicitly public-qualified.
set search_path = pg_catalog, extensions, public
as $$
  with mentions as (
    select distinct normalized
    from unnest(coalesce(p_company_mentions, array[]::text[])) as raw(value),
         lateral (select public.normalize_company_name(raw.value)) as folded(normalized)
    where folded.normalized is not null
  ),
  -- Links in the body are parsed with the same URL logic that fingerprinted
  -- the application, so a Greenhouse board link in a confirmation email
  -- yields the identical tenant that was stored at save time.
  link_identity as (
    select identity.tenant, identity.job_id
    from unnest(coalesce(p_link_urls, array[]::text[])) as link(url),
         lateral public.ats_identity(link.url) as identity
  ),
  -- A job ID read out of a link carries the employer it belongs to, so it is
  -- only allowed to match applications at that same employer. Requisition
  -- numbers are unique within a company, not across them.
  scoped_job_ids as (
    select distinct lower(btrim(tenant)) as tenant, lower(btrim(job_id)) as value
    from link_identity
    where btrim(coalesce(tenant, '')) <> '' and btrim(coalesce(job_id, '')) <> ''
  ),
  -- An ID quoted in prose arrives with no employer attached. It can still
  -- retrieve a candidate, but the caller requires corroboration before
  -- treating it as identity.
  bare_job_ids as (
    select distinct lower(btrim(value)) as value
    from (
      select unnest(coalesce(p_job_id_mentions, array[]::text[])) as value
      union all
      select job_id from link_identity where tenant is null and job_id is not null
    ) as combined
    where btrim(coalesce(value, '')) <> ''
  ),
  tenants as (
    select distinct lower(btrim(tenant)) as value
    from link_identity
    where btrim(coalesce(tenant, '')) <> ''
  ),
  candidates as (
    select
      applications.id,
      applications.company,
      applications.company_normalized,
      applications.position,
      applications.status,
      applications.job_id,
      applications.ats_job_id,
      applications.ats_tenant,
      applications.company_tokens,
      applications.applied_at,
      applications.created_at
    from public.applications
    where applications.user_id = p_user_id
      and (
        -- Token overlap is index-backed; the remaining arms are exact
        -- identifiers that must retrieve a row even when no word is shared.
        applications.company_tokens && coalesce(p_tokens, array[]::text[])
        or applications.id = p_thread_application_id
        or lower(coalesce(applications.job_id, '')) in (select value from bare_job_ids)
        or lower(coalesce(applications.ats_job_id, '')) in (select value from bare_job_ids)
        or exists (
          select 1 from scoped_job_ids
          where scoped_job_ids.tenant = lower(coalesce(applications.ats_tenant, ''))
            and scoped_job_ids.value in (
              lower(coalesce(applications.job_id, '')),
              lower(coalesce(applications.ats_job_id, ''))
            )
        )
        or lower(coalesce(applications.ats_tenant, '')) in (select value from tenants)
      )
  )
  select
    candidates.id,
    candidates.company,
    candidates.position,
    candidates.status,
    candidates.id = p_thread_application_id,
    lower(coalesce(candidates.job_id, '')) in (select value from bare_job_ids)
      or lower(coalesce(candidates.ats_job_id, '')) in (select value from bare_job_ids)
      or exists (
        select 1 from scoped_job_ids
        where scoped_job_ids.tenant = lower(coalesce(candidates.ats_tenant, ''))
          and scoped_job_ids.value in (
            lower(coalesce(candidates.job_id, '')),
            lower(coalesce(candidates.ats_job_id, ''))
          )
      ),
    lower(coalesce(candidates.ats_tenant, '')) in (select value from tenants),
    exists (select 1 from mentions where mentions.normalized = candidates.company_normalized),
    coalesce(
      (select max(similarity(mentions.normalized, candidates.company_normalized))
       from mentions),
      0
    )::real,
    -- A conflict is only meaningful when the email named a company at all.
    -- Without mentions there is nothing to disagree with. Note this is a fact,
    -- not a verdict: a message quoting an exact requisition ID while naming a
    -- parent company is a conflicting name on a correct match, and the caller
    -- is responsible for letting the identifier win.
    (
      exists (select 1 from mentions)
      and coalesce(
        (select max(similarity(mentions.normalized, candidates.company_normalized))
         from mentions),
        0
      ) < 0.35
    ),
    -- Which of this application's tokens the message actually contained. This
    -- is why the row was retrieved when no exact identifier matched, and it
    -- lets the caller weight a distinctive name above a generic one.
    coalesce(
      (select array_agg(token order by token)
       from unnest(candidates.company_tokens) as t(token)
       where token = any(coalesce(p_tokens, array[]::text[]))),
      array[]::text[]
    ),
    (abs(extract(epoch from (p_received_at - coalesce(candidates.applied_at, candidates.created_at)))) / 86400.0)::real
  from candidates;
$$;

comment on function public.match_email_candidates(uuid, text[], text[], text[], text[], timestamptz, uuid) is
  'Narrows inbound email to candidate applications and reports match evidence.';

revoke all on function public.match_email_candidates(uuid, text[], text[], text[], text[], timestamptz, uuid) from public;
grant execute on function public.match_email_candidates(uuid, text[], text[], text[], text[], timestamptz, uuid) to authenticated;
grant execute on function public.match_email_candidates(uuid, text[], text[], text[], text[], timestamptz, uuid) to service_role;
