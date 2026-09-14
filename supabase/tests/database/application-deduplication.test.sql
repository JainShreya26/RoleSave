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
    v_other_id, auth.uid(), 'INTERVIEW_REQUESTED', now(), 'EMAIL',
    'Interview email', 'APPLIED', 'INTERVIEW'
  );
  insert into public.email_events (application_id, user_id) values (v_other_id, auth.uid());
  insert into public.review_tasks (user_id, suggested_application_ids)
  values (auth.uid(), array[v_other_id, v_first.application_id]);

  perform public.merge_duplicate_applications(v_first.application_id, v_other_id);

  if exists (select 1 from public.applications where id = v_other_id) then
    raise exception '  FAIL  duplicate shell was not removed';
  end if;
  if (select status from public.applications where id = v_first.application_id) <> 'INTERVIEW' then
    raise exception '  FAIL  furthest status was not preserved';
  end if;
  if not exists (select 1 from public.email_events where application_id = v_first.application_id)
    or not exists (
      select 1 from public.application_events
      where application_id = v_first.application_id and evidence = 'Interview email'
    )
  then
    raise exception '  FAIL  dependent evidence was not moved';
  end if;
  if (select suggested_application_ids from public.review_tasks limit 1)
    is distinct from array[v_first.application_id]
  then
    raise exception '  FAIL  review suggestions were not rewritten/deduplicated';
  end if;

  raise notice '  all cases passed';
end $$;
