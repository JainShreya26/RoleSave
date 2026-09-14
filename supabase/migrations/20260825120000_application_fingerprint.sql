-- Application identity fingerprint.
--
-- Matching an email to an application used to depend on delimiting a company
-- name out of English prose, which fails on abbreviations, on mail sent by an
-- ATS relay, and on anything written by a person rather than a template. This
-- migration derives a durable fingerprint from data the extension already
-- captures: the ATS provider, tenant, and job ID encoded in the posting URL,
-- plus normalized company tokens that an email can be searched for.
--
-- Everything here is derived by trigger, so existing rows gain a fingerprint
-- from their stored original_url without being re-captured.

-- ---------------------------------------------------------------------------
-- Company normalization
-- ---------------------------------------------------------------------------

-- Folds a display company name to a comparable form: accent-stripped,
-- punctuation-free, without legal suffixes. "Northwind, N.A." and "Northwind"
-- both fold to "northwind" so they compare equal.
create function public.normalize_company_name(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select nullif(
    btrim(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              -- Accent folding without depending on the unaccent extension.
              -- The two arguments are position-aligned; keep them the same
              -- length when editing or characters silently map to the wrong
              -- letter.
              translate(
                lower(coalesce(p_value, '')),
                'áàâäãåāçćčéèêëēėęíìîïīıñńóòôöõøōšśúùûüūýÿžźż',
                'aaaaaaaccceeeeeeeiiiiiinnooooooossuuuuuyyzzz'
              ),
              '&', ' and ', 'g'
            ),
            -- Anything that is not a letter or digit is a separator.
            '[^a-z0-9]+', ' ', 'g'
          ),
          -- Legal suffixes and bare TLD fragments carry no identifying signal.
          '\y(incorporated|inc|llc|ltd|limited|corporation|corp|company|co|plc|'
          || 'holdings|holding|group|gmbh|ag|nv|bv|pty|pvt|spa|sarl|oy|ab|as|'
          || 'n a|na|s a|sa|se|the|com|net|org|io|ai)\y', ' ', 'g'
        ),
        '\s+', ' ', 'g'
      )
    ),
    ''
  );
$$;

comment on function public.normalize_company_name(text) is
  'Folds a company display name to a comparable form for matching.';

-- ---------------------------------------------------------------------------
-- ATS identity from the posting URL
-- ---------------------------------------------------------------------------

-- Extracts (provider, tenant, job_id) from a job posting URL. The tenant is
-- the employer's identifier inside the ATS: it survives the relay domain that
-- confirmation email is actually sent from, which the sender domain does not.
-- Returns nulls rather than raising when a URL is unrecognized.
create function public.ats_identity(p_url text)
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

  -- Greenhouse, hosted board: job-boards.greenhouse.io/{tenant}/jobs/{id}
  if v_host ~ '(^|\.)greenhouse\.io$' then
    provider := 'greenhouse';
    v_match := regexp_match(v_path, '^/([^/]+)/jobs/([0-9]+)');
    if v_match is not null then
      tenant := v_match[1];
      job_id := v_match[2];
    end if;
    return next;
    return;
  end if;

  -- Ashby, hosted board: jobs.ashbyhq.com/{tenant}/{uuid}
  if v_host ~ '(^|\.)ashbyhq\.com$' then
    provider := 'ashby';
    v_match := regexp_match(v_path, '^/([^/]+)/([0-9a-f-]{8,})');
    if v_match is not null then
      tenant := v_match[1];
      job_id := v_match[2];
    end if;
    return next;
    return;
  end if;

  -- Lever, hosted board: jobs.lever.co/{tenant}/{uuid}
  if v_host ~ '(^|\.)lever\.co$' then
    provider := 'lever';
    v_match := regexp_match(v_path, '^/([^/]+)/([0-9a-f-]{8,})');
    if v_match is not null then
      tenant := v_match[1];
      job_id := v_match[2];
    end if;
    return next;
    return;
  end if;

  -- SmartRecruiters: jobs.smartrecruiters.com/{tenant}/{id}
  if v_host ~ '(^|\.)smartrecruiters\.com$' then
    provider := 'smartrecruiters';
    v_match := regexp_match(v_path, '^/([^/]+)/([0-9]+)');
    if v_match is not null then
      tenant := v_match[1];
      job_id := v_match[2];
    end if;
    return next;
    return;
  end if;

  -- Workday: {tenant}.wd{n}.myworkdayjobs.com/.../Title_{REQ-ID}
  if v_host ~ '(^|\.)myworkdayjobs\.com$' then
    provider := 'workday';
    tenant := split_part(v_host, '.', 1);
    -- Requisition IDs trail the title after an underscore and always contain a
    -- digit, but may lead with hyphenated letters, as in "..._REQ-48391".
    v_match := regexp_match(v_path, '_([a-z0-9-]*[0-9][a-z0-9-]*)$');
    if v_match is not null then
      job_id := v_match[1];
    end if;
    return next;
    return;
  end if;

  -- iCIMS: {tenant}.icims.com/jobs/{id}/...
  if v_host ~ '(^|\.)icims\.com$' then
    provider := 'icims';
    tenant := split_part(v_host, '.', 1);
    v_match := regexp_match(v_path, '/jobs/([0-9]+)');
    if v_match is not null then
      job_id := v_match[1];
    end if;
    return next;
    return;
  end if;

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
  declare
    v_labels text[] := string_to_array(v_host, '.');
    v_count integer := array_length(v_labels, 1);
    v_index integer;
  begin
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
  end;

  if tenant is not null and char_length(tenant) < 3 then
    tenant := null;
  end if;

  return next;
end;
$$;

comment on function public.ats_identity(text) is
  'Extracts the ATS provider, employer tenant, and job ID from a posting URL.';

-- ---------------------------------------------------------------------------
-- Search tokens
-- ---------------------------------------------------------------------------

-- Produces the token set an inbound email is searched for. Tokens come from
-- the normalized company name plus the ATS tenant, which is what rescues rows
-- whose scraped company name is a hostname or a parent-company alias.
create function public.company_search_tokens(p_company text, p_tenant text)
returns text[]
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(
    array_agg(distinct token order by token),
    array[]::text[]
  )
  from (
    select unnest(
      string_to_array(
        coalesce(public.normalize_company_name(p_company), '') || ' ' ||
        coalesce(public.normalize_company_name(p_tenant), ''),
        ' '
      )
    ) as token
  ) candidates
  where char_length(token) >= 3
    and token !~ '^[0-9]+$';
$$;

comment on function public.company_search_tokens(text, text) is
  'Token set used to detect a tracked company inside inbound email text.';

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.applications
  add column ats_provider text,
  add column ats_tenant text,
  add column ats_job_id text,
  add column company_tokens text[] not null default array[]::text[];

comment on column public.applications.ats_tenant is
  'Employer identifier inside the ATS, derived from original_url.';
comment on column public.applications.ats_job_id is
  'Job or requisition ID derived from original_url. Distinct from job_id, which is user or page supplied.';

-- ---------------------------------------------------------------------------
-- Trigger: one place that normalizes, replacing the divergent copy in the worker
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
    new.ats_provider := null;
    new.ats_tenant := null;
    new.ats_job_id := null;
  end if;

  new.company_tokens := public.company_search_tokens(new.company, new.ats_tenant);

  return new;
end;
$$;

-- original_url now feeds the fingerprint, so the trigger must see every write
-- that can change it.
drop trigger if exists applications_normalize_before_write on public.applications;
create trigger applications_normalize_before_write
before insert or update of company, position, original_url
on public.applications
for each row execute function public.normalize_application_fields();

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- Narrowing an inbound email to candidate applications is an array-overlap
-- query, which is what this index serves.
create index applications_company_tokens_idx
  on public.applications using gin(company_tokens);

-- The position index already exists; company similarity needs the same.
create index applications_company_trgm_idx
  on public.applications using gin(company_normalized gin_trgm_ops);

create index applications_user_ats_idx
  on public.applications(user_id, ats_provider, ats_tenant)
  where ats_tenant is not null;

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------

-- Re-run the trigger over existing rows so applications saved before this
-- migration gain a fingerprint without being re-captured.
update public.applications set company = company;

-- ---------------------------------------------------------------------------
-- Capture session accepts the job ID read from the page
-- ---------------------------------------------------------------------------

-- JSON-LD JobPosting exposes identifier.value, which is the employer's own
-- requisition number and the single strongest matching signal available. The
-- extension had no way to send it, so applications.job_id was always null.
-- The new parameter is defaulted, so an older extension build keeps working.
drop function if exists public.create_capture_session(text, text, text, timestamptz, uuid);

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
  capture_status public.capture_status
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

  perform pg_advisory_xact_lock(
    hashtextextended(v_user_id::text || ':' || p_idempotency_key::text, 0)
  );

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
      v_job_id,
      v_application_id,
      v_document_id,
      v_temporary_storage_path,
      v_output_storage_path,
      (select status from public.capture_jobs where id = v_job_id);
    return;
  end if;

  v_job_id := gen_random_uuid();
  v_application_id := gen_random_uuid();
  v_document_id := gen_random_uuid();
  v_temporary_storage_path :=
    v_user_id::text || '/' || v_application_id::text || '/' || v_document_id::text || '.mhtml';
  v_output_storage_path :=
    v_user_id::text || '/' || v_application_id::text || '/job-description-' || v_document_id::text || '.pdf';

  -- company_normalized and position_normalized are placeholders here; the
  -- before-write trigger owns normalization and the fingerprint.
  insert into public.applications (
    id, user_id, company, company_normalized, position, position_normalized,
    status, source, original_url, job_id
  ) values (
    v_application_id, v_user_id, p_company, '', p_position, '',
    'SAVED', 'EXTENSION', p_original_url, p_job_id
  );

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
    v_job_id,
    v_application_id,
    v_document_id,
    v_temporary_storage_path,
    v_output_storage_path,
    'PENDING'::public.capture_status;
end;
$$;

revoke all on function public.create_capture_session(text, text, text, timestamptz, uuid, text) from public;
grant execute on function public.create_capture_session(text, text, text, timestamptz, uuid, text) to authenticated;
