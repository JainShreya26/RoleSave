-- Generalized ATS board handling, and a company-suffix correction.
--
-- Two faults surfaced on a real save from jobs.gem.com:
--
--   1. Gem was unrecognized, so the URL fell through to the employer-hosted
--      branch and the tenant became "gem" -- the ATS vendor rather than the
--      employer. Every application saved from that vendor would have shared
--      one tenant token and collided with the others.
--
--   2. "Obin AI" normalized to "obin", because the suffix list stripped "ai"
--      as a bare TLD fragment. For a company whose name ends in AI that
--      discards the distinguishing half of the name.
--
-- Rather than adding one vendor, this recognizes the two shapes nearly every
-- board uses -- tenant in the first path segment, or tenant in the subdomain
-- -- so an unlisted vendor is far more likely to parse correctly. When a host
-- is a known board but the tenant cannot be read, the tenant is left null:
-- no tenant is better than the vendor's name.

-- ---------------------------------------------------------------------------
-- Company normalization: stop stripping "ai"
-- ---------------------------------------------------------------------------

create or replace function public.normalize_company_name(p_value text)
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
          -- "ai" is deliberately absent: it ends a great many real company
          -- names and stripping it leaves "Obin AI" as "obin".
          '\y(incorporated|inc|llc|ltd|limited|corporation|corp|company|co|plc|'
          || 'holdings|holding|group|gmbh|ag|nv|bv|pty|pvt|spa|sarl|oy|ab|as|'
          || 'n a|na|s a|sa|se|the|com|net|org|io)\y', ' ', 'g'
        ),
        '\s+', ' ', 'g'
      )
    ),
    ''
  );
$$;

-- ---------------------------------------------------------------------------
-- ATS identity: recognize board families, not just named vendors
-- ---------------------------------------------------------------------------

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
      -- The segment after the tenant is the posting, under whatever noun the
      -- vendor uses ("jobs", "j", "o") or none at all.
      v_match := regexp_match(v_path, '^/([a-z0-9][a-z0-9._-]*)(?:/(?:jobs?|j|o|p)?/?)?([a-z0-9][a-z0-9._~-]{2,})?');
      if v_match is not null then
        tenant := v_match[1];
        job_id := v_match[2];
      end if;
      -- A segment that is only a vendor route word is not an employer.
      if tenant in ('jobs', 'job', 'careers', 'search', 'company', 'companies', 'apply') then
        tenant := null;
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
      -- Requisition IDs trail the title after an underscore and always
      -- contain a digit, but may lead with hyphenated letters.
      v_match := regexp_match(v_path, '_([a-z0-9-]*[0-9][a-z0-9-]*)$');
      if v_match is null then
        v_match := regexp_match(v_path, '/(?:jobs?|p|o)/([a-z0-9][a-z0-9-]{2,})');
      end if;
      if v_match is not null then
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
-- Re-derive the fingerprint for rows saved before this correction
-- ---------------------------------------------------------------------------

update public.applications set company = company;
