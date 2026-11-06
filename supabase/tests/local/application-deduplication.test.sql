-- Durable application identity and lossless merge regression tests.

set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

do $$
declare
  v_first record;
  v_second record;
  v_count integer;
  v_other_id uuid := 'dddddddd-0000-0000-0000-000000000002';
begin
  raise notice 'application deduplication';

  select * into v_first from public.create_capture_session(
    'Northwind, N.A.', 'Artificial Intelligence Analyst, I',
    'https://job-boards.greenhouse.io/northwind/jobs/7000000002?gh_src=first',
    '2026-08-25T20:00:00Z', '10000000-0000-4000-8000-000000000001', '7000000002');

  update public.capture_jobs set status = 'COMPLETE', completed_at = now() where id = v_first.job_id;
  update public.documents set capture_status = 'COMPLETE' where id = v_first.document_id;

  select * into v_second from public.create_capture_session(
    'Northwind', 'AI Analyst',
    'https://job-boards.greenhouse.io/northwind/jobs/7000000002?gh_src=second#apply',
    '2026-08-26T20:00:00Z', '10000000-0000-4000-8000-000000000002', '7000000002');

  if v_second.application_id is distinct from v_first.application_id
    or v_second.job_id is distinct from v_first.job_id
    or not v_second.application_reused
  then
    raise exception '  FAIL  second capture did not reuse first application/session: first %, second %', v_first, v_second;
  end if;

  select count(*) into v_count
  from public.applications
  where user_id = auth.uid()
    and identity_key = 'ats:greenhouse:northwind:7000000002';
  if v_count <> 1 then
    raise exception '  FAIL  expected one Northwind application, got %', v_count;
  end if;

  if public.find_existing_application(
    'https://job-boards.greenhouse.io/northwind/jobs/7000000002',
    'Northwind', null
  ) is distinct from v_first.application_id then
    raise exception '  FAIL  dashboard lookup did not find existing application';
  end if;

  begin
    insert into public.applications (
      user_id, company, company_normalized, position, position_normalized,
      status, source, original_url
    ) values (
      auth.uid(), 'Northwind', '', 'AI Analyst', '', 'SAVED', 'MANUAL',
      'https://job-boards.greenhouse.io/northwind/jobs/7000000002'
    );
    raise exception '  FAIL  duplicate identity insert unexpectedly succeeded';
  exception when unique_violation then
    null;
  end;

  -- Explicit merge also works for a duplicate that lacks enough identity
  -- evidence for automatic detection and preserves every dependent record.
  insert into public.applications (
    id, user_id, company, company_normalized, position, position_normalized,
    status, source, original_url, applied_at
  ) values (
    v_other_id, auth.uid(), 'Northwind N A', '', 'AI role copy', '',
    'INTERVIEW', 'MANUAL', null, '2026-08-25T21:15:00Z'
  );
  insert into public.application_events (
    application_id, user_id, event_type, event_time, source, evidence,
    previous_status, new_status
  ) values (
    v_other_id, auth.uid(), 'GENERAL_UPDATE', now(), 'MANUAL',
    'Interview note', 'APPLIED', 'INTERVIEW'
  );

  perform public.merge_duplicate_applications(v_first.application_id, v_other_id);

  if exists (select 1 from public.applications where id = v_other_id) then
    raise exception '  FAIL  duplicate shell was not removed';
  end if;
  if (select status from public.applications where id = v_first.application_id) <> 'INTERVIEW' then
    raise exception '  FAIL  furthest status was not preserved';
  end if;
  if not exists (
    select 1 from public.application_events
    where application_id = v_first.application_id and evidence = 'Interview note'
  )
  then
    raise exception '  FAIL  dependent evidence was not moved';
  end if;

  raise notice '  all cases passed';
end $$;

-- Which URLs and job IDs count as the same posting.
do $$
declare
  v_case record;
  v_first text;
  v_second text;
  v_failed integer := 0;
begin
  raise notice 'posting identity';

  for v_case in
    select * from (values
      -- Different jobs must stay apart. A false duplicate loses the job.
      (false, 'query ID',            'https://careers.acme.com/job?id=1', 'Acme', null, 'https://careers.acme.com/job?id=2', 'Acme', null),
      (false, 'ref holding job ID',  'https://careers.acme.com/job?ref=JR1', 'Acme', null, 'https://careers.acme.com/job?ref=JR2', 'Acme', null),
      (false, 'hash route',          'https://careers.acme.com/#/jobs/1', 'Acme', null, 'https://careers.acme.com/#/jobs/2', 'Acme', null),
      (false, 'LinkedIn search job', 'https://www.linkedin.com/jobs/search/?currentJobId=111&keywords=x', 'Acme', null, 'https://www.linkedin.com/jobs/search/?currentJobId=222&keywords=x', 'Beta', null),
      (false, 'Indeed search job',   'https://www.indeed.com/jobs?q=x&vjk=aaa', 'Acme', null, 'https://www.indeed.com/jobs?q=x&vjk=bbb', 'Beta', null),
      (false, 'two job IDs',         'https://careers.acme.com/job', 'Acme', 'REQ-1', 'https://careers.acme.com/job', 'Acme', 'REQ-2'),
      (false, 'same ID, employers',  'https://acme.com/job', 'Acme', 'REQ-1', 'https://beta.com/job', 'Beta', 'REQ-1'),
      (false, 'shared label as ID',  'https://careers.acme.com/jobs/1', 'Acme', 'engineering', 'https://careers.acme.com/jobs/2', 'Acme', 'engineering'),
      -- The same job must still match.
      (true,  'tracking parameters', 'https://careers.acme.com/jobs/1?utm_source=a&gclid=b', 'Acme', null, 'https://www.careers.acme.com/jobs/1/', 'Acme', null),
      (true,  'attribution ref',     'https://careers.acme.com/jobs/1?ref=linkedin', 'Acme', null, 'https://careers.acme.com/jobs/1?ref=indeed', 'Acme', null),
      (true,  'parameter order',     'https://careers.acme.com/job?id=1&team=2', 'Acme', null, 'https://careers.acme.com/job?team=2&id=1', 'Acme', null),
      (true,  'scroll fragment',     'https://careers.acme.com/jobs/1#apply', 'Acme', null, 'https://careers.acme.com/jobs/1', 'Acme', null),
      (true,  'job ID, two URLs',    'https://acme.com/careers/data-engineer', 'Acme', 'REQ-1', 'https://jobs.acme.com/r/REQ-1', 'Acme', 'REQ-1'),
      (true,  'LinkedIn view pages', 'https://www.linkedin.com/jobs/view/senior-engineer-at-acme-4012345678/', 'Acme', null, 'https://www.linkedin.com/jobs/search/?currentJobId=4012345678&keywords=x', 'Acme', null),
      (true,  'Indeed view pages',   'https://www.indeed.com/viewjob?jk=abc123&from=serp', 'Acme', null, 'https://uk.indeed.com/jobs?q=x&vjk=abc123', 'Acme', null),
      (true,  'ATS outranks job ID', 'https://jobs.lever.co/acme/6ed76ce8-4156-4b60-b120-403538bd66cd', 'Acme', 'REQ-1', 'https://jobs.lever.co/acme/6ed76ce8-4156-4b60-b120-403538bd66cd/apply', 'Acme Inc', null)
    ) as cases(same, label, url_a, company_a, id_a, url_b, company_b, id_b)
  loop
    v_first := public.application_identity_key(v_case.url_a, v_case.company_a, v_case.id_a);
    v_second := public.application_identity_key(v_case.url_b, v_case.company_b, v_case.id_b);
    if v_first is null or v_second is null or (v_first = v_second) <> v_case.same then
      raise warning '  FAIL  %: % and % (expected same = %)', v_case.label, v_first, v_second, v_case.same;
      v_failed := v_failed + 1;
    end if;
  end loop;

  if v_failed > 0 then
    raise exception 'posting identity: % failing case(s)', v_failed;
  end if;

  raise notice '  all cases passed';
end $$;
