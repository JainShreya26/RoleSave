-- Candidate retrieval regression tests.
--
-- Runs against a database with the fingerprint and matching migrations
-- applied. Every check raises on failure.
--
--   pnpm test:fingerprint

-- A fixed user and the real posting URLs the fingerprint was designed against.
insert into public.applications
  (id, user_id, company, company_normalized, position, position_normalized, status, original_url, applied_at)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Northwind, N.A.', '', 'Artificial Intelligence Analyst, I', '', 'APPLIED',
   'https://job-boards.greenhouse.io/northwind/jobs/7000000004', '2026-08-25T16:31:59Z'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'northstar.com', '', 'DS', '', 'APPLIED',
   'https://www.northstar.com/jobs/?ashby_jid=11111111-2222-4333-8444-555555555555', '2026-08-25T04:54:07Z'),
  ('aaaaaaaa-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'Harbor Insurance Company', '', 'Data Scientist', '', 'SAVED',
   'https://harbor.wd5.myworkdayjobs.com/Harbor Group_Careers/job/Chicago-IL/Data-Scientist_REQ-48391', null),
  ('aaaaaaaa-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   'Machinify', '', 'Data Scientist | Modeling', '', 'APPLIED',
   'https://job-boards.greenhouse.io/machinifyinc/jobs/4208658009', '2026-08-23T22:07:31Z'),
  -- A second user's application, to prove retrieval never crosses accounts.
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'Northwind, N.A.', '', 'Data Engineer', '', 'APPLIED',
   'https://job-boards.greenhouse.io/northwind/jobs/7000000001', '2026-08-25T16:00:00Z');

do $$
declare
  v_row record;
  v_count integer;
begin
  raise notice 'match_email_candidates';

  -- The confirmation that started this: company named in subject, body, and
  -- sender display name; no position and no job ID anywhere in the message.
  select * into v_row from public.match_email_candidates(
    '11111111-1111-1111-1111-111111111111',
    array['northwind','hooray','discovering','opportunities','culture'],
    array['Northwind, N.A.'], array[]::text[], array[]::text[],
    '2026-08-25T16:35:00Z'::timestamptz, null);
  if v_row.application_id is distinct from 'aaaaaaaa-0000-0000-0000-000000000001'::uuid then
    raise exception '  FAIL  confirmation retrieved %', v_row.application_id;
  end if;
  if not v_row.company_exact or v_row.company_conflict then
    raise exception '  FAIL  confirmation evidence: exact=% conflict=%', v_row.company_exact, v_row.company_conflict;
  end if;

  -- A hiring manager writing from the employer domain. The only occurrence of
  -- the company anywhere in the message is inside "hiring.manager@northwind.example",
  -- which reaches the token list as a search surface.
  select * into v_row from public.match_email_candidates(
    '11111111-1111-1111-1111-111111111111',
    array['jane','doe','northwind','thursday','calendly'],
    array[]::text[], array[]::text[], array['https://calendar.example/interview'],
    '2026-08-26T14:00:00Z'::timestamptz, null);
  if v_row.application_id is distinct from 'aaaaaaaa-0000-0000-0000-000000000001'::uuid then
    raise exception '  FAIL  manager note retrieved %', v_row.application_id;
  end if;
  -- No company was named, so there is nothing to conflict with.
  if v_row.company_conflict then
    raise exception '  FAIL  manager note reported a conflict with no mentions';
  end if;
  if not (v_row.matched_tokens @> array['northwind']) then
    raise exception '  FAIL  manager note tokens %', v_row.matched_tokens;
  end if;

  -- A requisition ID quoted by a message naming a different employer must
  -- report both the ID match and the company conflict for the caller to weigh.
  select * into v_row from public.match_email_candidates(
    '11111111-1111-1111-1111-111111111111',
    array['acme','careers'], array['Acme Health'], array['REQ-48391'], array[]::text[],
    '2026-09-10T10:00:00Z'::timestamptz, null);
  if v_row.application_id is distinct from 'aaaaaaaa-0000-0000-0000-000000000003'::uuid then
    raise exception '  FAIL  requisition match retrieved %', v_row.application_id;
  end if;
  if not v_row.matched_job_id or not v_row.company_conflict then
    raise exception '  FAIL  requisition evidence: job_id=% conflict=%', v_row.matched_job_id, v_row.company_conflict;
  end if;

  -- A board link in the body identifies the employer when the prose does not.
  select * into v_row from public.match_email_candidates(
    '11111111-1111-1111-1111-111111111111',
    array['regarding','status'], array[]::text[], array[]::text[],
    array['https://job-boards.greenhouse.io/northwind/jobs/7000000004'],
    '2026-08-27T10:00:00Z'::timestamptz, null);
  if v_row.application_id is distinct from 'aaaaaaaa-0000-0000-0000-000000000001'::uuid then
    raise exception '  FAIL  link-only match retrieved %', v_row.application_id;
  end if;
  if not v_row.matched_tenant or not v_row.matched_job_id then
    raise exception '  FAIL  link-only evidence: tenant=% job_id=%', v_row.matched_tenant, v_row.matched_job_id;
  end if;

  -- Unrelated mail retrieves nothing rather than the least-bad guess.
  select count(*) into v_count from public.match_email_candidates(
    '11111111-1111-1111-1111-111111111111',
    array['amazon','order','shipped'], array[]::text[], array[]::text[], array[]::text[],
    now(), null);
  if v_count <> 0 then
    raise exception '  FAIL  unrelated mail retrieved % candidates', v_count;
  end if;

  -- Retrieval is scoped to the owner even when another account tracks the
  -- same employer and the same ATS tenant.
  select count(*) into v_count from public.match_email_candidates(
    '11111111-1111-1111-1111-111111111111',
    array['northwind'], array['Northwind, N.A.'], array[]::text[], array[]::text[],
    '2026-08-25T16:35:00Z'::timestamptz, null);
  if v_count <> 1 then
    raise exception '  FAIL  cross-account leak: % candidates', v_count;
  end if;

  -- The thread arm retrieves a row that shares no word and no identifier.
  select * into v_row from public.match_email_candidates(
    '11111111-1111-1111-1111-111111111111',
    array['scheduling','confirmed'], array[]::text[], array[]::text[], array[]::text[],
    now(), 'aaaaaaaa-0000-0000-0000-000000000004'::uuid);
  if v_row.application_id is distinct from 'aaaaaaaa-0000-0000-0000-000000000004'::uuid
    or not v_row.matched_thread
  then
    raise exception '  FAIL  thread match retrieved % (thread=%)', v_row.application_id, v_row.matched_thread;
  end if;

  -- A job ID read out of a link belongs to the employer in that link. It must
  -- not match a different employer that happens to reuse the number, which
  -- "REQ-#####" style requisitions routinely do.
  insert into public.applications
    (id, user_id, company, company_normalized, position, position_normalized, status, original_url, job_id, applied_at)
  values
    ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
     'Acme Health', '', 'Data Analyst', '', 'APPLIED',
     'https://acme.wd5.myworkdayjobs.com/careers/job/Remote/Data-Analyst_REQ-48391', 'REQ-48391', '2026-08-01T10:00:00Z'),
    ('cccccccc-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
     'Northwind Labs', '', 'Research Engineer', '', 'APPLIED',
     'https://northwind.wd3.myworkdayjobs.com/jobs/job/NY/Research-Engineer_REQ-48391', 'REQ-48391', '2026-08-10T10:00:00Z');

  -- Both new rows are retrieved (the message names Northwind), so this
  -- exercises the reported fact rather than passing on a missing row.
  select count(*) into v_count
  from public.match_email_candidates(
    '11111111-1111-1111-1111-111111111111',
    array['acme','health','northwind','requisition'], array[]::text[], array[]::text[],
    array['https://acme.wd5.myworkdayjobs.com/careers/job/Remote/Data-Analyst_REQ-48391'],
    '2026-08-20T10:00:00Z'::timestamptz, null) c
  where c.application_id in (
    'cccccccc-0000-0000-0000-000000000001'::uuid,
    'cccccccc-0000-0000-0000-000000000002'::uuid
  );
  if v_count <> 2 then
    raise exception '  FAIL  expected both employers retrieved, got %', v_count;
  end if;

  select count(*) into v_count
  from public.match_email_candidates(
    '11111111-1111-1111-1111-111111111111',
    array['acme','health','northwind','requisition'], array[]::text[], array[]::text[],
    array['https://acme.wd5.myworkdayjobs.com/careers/job/Remote/Data-Analyst_REQ-48391'],
    '2026-08-20T10:00:00Z'::timestamptz, null) c
  where c.matched_job_id and c.application_id = 'cccccccc-0000-0000-0000-000000000002'::uuid;
  if v_count <> 0 then
    raise exception '  FAIL  a link-scoped requisition matched another employer reusing the number';
  end if;

  select count(*) into v_count
  from public.match_email_candidates(
    '11111111-1111-1111-1111-111111111111',
    array['acme','health','northwind','requisition'], array[]::text[], array[]::text[],
    array['https://acme.wd5.myworkdayjobs.com/careers/job/Remote/Data-Analyst_REQ-48391'],
    '2026-08-20T10:00:00Z'::timestamptz, null) c
  where c.matched_job_id and c.application_id = 'cccccccc-0000-0000-0000-000000000001'::uuid;
  if v_count <> 1 then
    raise exception '  FAIL  a link-scoped requisition did not match its own employer';
  end if;

  raise notice '  all cases passed';
end $$;
