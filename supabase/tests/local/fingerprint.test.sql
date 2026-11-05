-- Fingerprint regression tests.
--
-- Runs against any PostgreSQL database that has the fingerprint migration
-- applied. Every check raises on failure, so a clean run means all passed.
--
--   pnpm test:fingerprint
--
-- These exist because the failures they guard against are silent: a
-- misaligned translate() table maps accents to the wrong letter, and a
-- regexp that misses one URL shape simply yields null instead of erroring.

-- Each concern is one anonymous block comparing a table of expectations, so a
-- run reports every failing case in that group before aborting.

-- ---------------------------------------------------------------------------
do $$
declare
  v_row record;
  v_failed integer := 0;
begin
  raise notice 'normalize_company_name';
  for v_row in
    select * from (values
      ('Northwind, N.A.',            'northwind'),
      ('Northwind',                  'northwind'),
      ('NORTHWIND N.A.',            'northwind'),
      ('  Northwind   N.A.  ',       'northwind'),
      -- "Labs" is part of the display name, not a legal suffix.
      ('Northstar Labs',          'northstar labs'),
      ('northstar.com',                'northstar'),
      ('Harbor Group Corp',               'harbor'),
      ('Acme Health Systems, Inc.', 'acme health systems'),
      ('Johnson & Johnson',         'johnson and johnson'),
      -- "AI" ends a great many real company names. Stripping it as a bare TLD
      -- fragment reduced "Obin AI" to "obin".
      ('Obin AI',                   'obin ai'),
      ('Scale AI, Inc.',            'scale ai'),
      -- A hostname scraped into the company field still loses its TLD.
      ('northstar.io',                 'northstar'),
      -- Accent folding must not corrupt unaccented neighbours; a misaligned
      -- translate() table turned this into "socictc gcncrale".
      ('Société Générale',          'societe generale'),
      ('Zürich Insurance',          'zurich insurance'),
      ('',                          null),
      (null,                        null)
    ) as t(input, expected)
  loop
    if public.normalize_company_name(v_row.input) is distinct from v_row.expected then
      v_failed := v_failed + 1;
      raise warning '  FAIL  %  ->  %  (expected %)',
        coalesce(quote_literal(v_row.input), 'null'),
        coalesce(quote_literal(public.normalize_company_name(v_row.input)), 'null'),
        coalesce(quote_literal(v_row.expected), 'null');
    end if;
  end loop;
  if v_failed > 0 then
    raise exception 'normalize_company_name: % failing case(s)', v_failed;
  end if;
  raise notice '  all cases passed';
end $$;

-- ---------------------------------------------------------------------------
do $$
declare
  v_row record;
  v_failed integer := 0;
  v_actual record;
begin
  raise notice 'ats_identity';
  for v_row in
    select * from (values
      ('https://job-boards.greenhouse.io/northwind/jobs/7000000004?gh_src=x',
       'greenhouse', 'northwind', '7000000004'),
      ('https://boards.greenhouse.io/stripe/jobs/6123456',
       'greenhouse', 'stripe', '6123456'),
      -- Requisition IDs may lead with hyphenated letters before the digits.
      ('https://harbor.wd5.myworkdayjobs.com/Harbor Group_Careers/job/Chicago-IL/Data-Scientist_REQ-48391',
       'workday', 'harbor', 'req-48391'),
      ('https://jobs.ashbyhq.com/quora/3ed186f3-2168-45aa-9837-bcf4a93c9913',
       'ashby', 'quora', '3ed186f3-2168-45aa-9837-bcf4a93c9913'),
      -- Embedded board on the employer's own domain: the job ID is in the
      -- query string and the host supplies the tenant.
      ('https://www.northstar.com/jobs/?ashby_jid=11111111-2222-4333-8444-555555555555',
       'ashby', 'northstar', '11111111-2222-4333-8444-555555555555'),
      ('https://www.acme.com/careers/apply?gh_jid=7788990',
       'greenhouse', 'acme', '7788990'),
      ('https://jobs.lever.co/figma/8d1a2f30-4c5b-11ee-be56-0242ac120002',
       'lever', 'figma', '8d1a2f30-4c5b-11ee-be56-0242ac120002'),
      ('https://jobs.smartrecruiters.com/Visa/744000012345678',
       'smartrecruiters', 'visa', '744000012345678'),
      ('https://careers-pepsico.icims.com/jobs/284419/data-scientist/job',
       'icims', 'careers-pepsico', '284419'),
      -- Employer-hosted with no ATS marker: take the registrable label, not
      -- the subdomain, so this is "northwind" rather than "careers".
      -- Gem was unrecognized and fell through to the employer-hosted branch,
      -- which named the ATS vendor "gem" as the employer.
      ('https://jobs.gem.com/obin-ai/am9icG9zdDrtea8l6d-xDWE4wSFhQzV6?rcid=linkedin',
       'gem', 'obin-ai', 'am9icg9zddrtea8l6d-xdwe4wsfhqzv6'),
      ('https://apply.workable.com/acme-corp/j/A1B2C3D4E5/',
       'workable', 'acme-corp', 'a1b2c3d4e5'),
      ('https://acme.breezy.hr/p/abc123-data-scientist',
       'breezy', 'acme', 'abc123-data-scientist'),
      ('https://acme.recruitee.com/o/data-scientist',
       'recruitee', 'acme', 'data-scientist'),
      -- A board host whose first segment is a vendor route word names no
      -- employer, and null beats reporting the route word as one. The posting
      -- ID after it is still real and is kept.
      ('https://jobs.gem.com/jobs/12345', 'gem', null, '12345'),
      ('https://careers.northwind.com/openings/analyst',
       null, 'northwind', null),
      ('https://jobs.acme.co.uk/roles/12',
       null, 'acme', null),
      ('not-a-url',  null, null, null),
      ('ftp://example.com/job', null, null, null),
      (null, null, null, null)
    ) as t(url, provider, tenant, job_id)
  loop
    select * into v_actual from public.ats_identity(v_row.url);
    if v_actual.provider is distinct from v_row.provider
      or v_actual.tenant is distinct from v_row.tenant
      or v_actual.job_id is distinct from v_row.job_id
    then
      v_failed := v_failed + 1;
      raise warning '  FAIL  %  ->  (%, %, %)  expected  (%, %, %)',
        coalesce(v_row.url, 'null'),
        coalesce(v_actual.provider, 'null'), coalesce(v_actual.tenant, 'null'), coalesce(v_actual.job_id, 'null'),
        coalesce(v_row.provider, 'null'), coalesce(v_row.tenant, 'null'), coalesce(v_row.job_id, 'null');
    end if;
  end loop;
  if v_failed > 0 then
    raise exception 'ats_identity: % failing case(s)', v_failed;
  end if;
  raise notice '  all cases passed';
end $$;
