-- Consolidating a duplicate application into the role being kept.

begin;

create extension if not exists pgtap with schema extensions;
select plan(25);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'a2000000-0000-4000-8000-00000000000a', 'authenticated', 'authenticated', 'merge-a@example.com', '', now(), '{}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a2000000-0000-4000-8000-00000000000a', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

-- ---------------------------------------------------------------------------
-- The kept role has no URL or job ID, and the duplicate has both
-- ---------------------------------------------------------------------------

insert into public.applications (
  id, user_id, company, company_normalized, position, position_normalized,
  status, source, original_url, job_id, applied_at
) values
  ('e2000000-0000-4000-8000-000000000001', auth.uid(), 'Merge Co', '', 'Engineer', '', 'SAVED', 'MANUAL', null, null, null),
  ('e2000000-0000-4000-8000-000000000002', auth.uid(), 'Merge Co', '', 'Engineer', '', 'APPLIED', 'EXTENSION',
    'https://merge.example.com/jobs/1', 'REQ-1', '2026-10-02T14:00:00Z');

insert into public.application_events (
  application_id, user_id, event_type, event_time, source, evidence
) values (
  'e2000000-0000-4000-8000-000000000002', auth.uid(), 'GENERAL_UPDATE', now(), 'MANUAL', 'Note on the duplicate'
);
insert into public.application_actions (application_id, user_id, title, due_at)
values ('e2000000-0000-4000-8000-000000000002', auth.uid(), 'Action on the duplicate', '2026-12-01T14:00:00Z');
insert into public.application_attachments (
  application_id, user_id, file_name, file_size_bytes, mime_type, storage_path
) values (
  'e2000000-0000-4000-8000-000000000002', auth.uid(), 'resume.pdf', 10, 'application/pdf',
  'a2000000-0000-4000-8000-00000000000a/merge-resume.pdf'
);
insert into public.documents (
  application_id, user_id, storage_path, capture_status
) values (
  'e2000000-0000-4000-8000-000000000002', auth.uid(),
  'a2000000-0000-4000-8000-00000000000a/merge-job-description.pdf', 'COMPLETE'
);

select lives_ok(
  $$ select public.merge_duplicate_applications('e2000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000002') $$,
  'a role with no URL can absorb a duplicate that has one'
);
select is((select count(*) from public.applications where id = 'e2000000-0000-4000-8000-000000000002'), 0::bigint, 'the duplicate is removed');
select is((select original_url from public.applications where id = 'e2000000-0000-4000-8000-000000000001'), 'https://merge.example.com/jobs/1', 'the URL moves to the kept role');
select is((select job_id from public.applications where id = 'e2000000-0000-4000-8000-000000000001'), 'REQ-1', 'the job ID moves to the kept role');
select is((select status::text from public.applications where id = 'e2000000-0000-4000-8000-000000000001'), 'APPLIED', 'the furthest status is kept');
select is((select applied_at from public.applications where id = 'e2000000-0000-4000-8000-000000000001'), '2026-10-02T14:00:00Z'::timestamptz, 'the applied date moves to the kept role');
select is(
  (select identity_key from public.applications where id = 'e2000000-0000-4000-8000-000000000001'),
  public.application_identity_key('https://merge.example.com/jobs/1', 'Merge Co', 'REQ-1'),
  'the kept role now owns the posting identity'
);
select is((select count(*) from public.application_events where application_id = 'e2000000-0000-4000-8000-000000000001' and evidence = 'Note on the duplicate'), 1::bigint, 'the timeline moves');
select is((select count(*) from public.application_actions where application_id = 'e2000000-0000-4000-8000-000000000001'), 1::bigint, 'actions move');
select is((select count(*) from public.application_attachments where application_id = 'e2000000-0000-4000-8000-000000000001'), 1::bigint, 'files move');
select is((select count(*) from public.documents where application_id = 'e2000000-0000-4000-8000-000000000001'), 1::bigint, 'PDFs move');
select is((select count(*) from public.application_events where application_id = 'e2000000-0000-4000-8000-000000000001' and evidence like 'Exact duplicate application consolidated%'), 1::bigint, 'the merge is logged on the timeline');

-- ---------------------------------------------------------------------------
-- Both roles have their own URL, and the decision comes from the duplicate
-- ---------------------------------------------------------------------------

insert into public.applications (
  id, user_id, company, company_normalized, position, position_normalized,
  status, source, original_url, triage_decision, triage_reason
) values
  ('e2000000-0000-4000-8000-000000000003', auth.uid(), 'Two Urls', '', 'Engineer', '', 'SAVED', 'MANUAL', 'https://two.example.com/a', null, null),
  ('e2000000-0000-4000-8000-000000000004', auth.uid(), 'Two Urls', '', 'Engineer', '', 'SAVED', 'MANUAL', 'https://two.example.com/b', 'PASS', 'Too far away');

select lives_ok(
  $$ select public.merge_duplicate_applications('e2000000-0000-4000-8000-000000000003', 'e2000000-0000-4000-8000-000000000004') $$,
  'two roles with different URLs can be merged'
);
select is((select original_url from public.applications where id = 'e2000000-0000-4000-8000-000000000003'), 'https://two.example.com/a', 'the kept role keeps its own URL');
select is((select triage_decision from public.applications where id = 'e2000000-0000-4000-8000-000000000003'), 'PASS', 'the saved-role decision is preserved');
select is((select triage_reason from public.applications where id = 'e2000000-0000-4000-8000-000000000003'), 'Too far away', 'the reason for the decision is preserved');

-- ---------------------------------------------------------------------------
-- Both roles have a decision, so the kept role's decision and reason stay together
-- ---------------------------------------------------------------------------

insert into public.applications (
  id, user_id, company, company_normalized, position, position_normalized,
  status, source, triage_decision, triage_reason
) values
  ('e2000000-0000-4000-8000-000000000008', auth.uid(), 'No Reason', '', 'Engineer', '', 'SAVED', 'MANUAL', 'PURSUE', null),
  ('e2000000-0000-4000-8000-000000000009', auth.uid(), 'No Reason', '', 'Engineer', '', 'SAVED', 'MANUAL', 'PASS', 'Too far away'),
  ('e2000000-0000-4000-8000-00000000000a', auth.uid(), 'Own Reason', '', 'Engineer', '', 'SAVED', 'MANUAL', 'MAYBE', 'Good team'),
  ('e2000000-0000-4000-8000-00000000000b', auth.uid(), 'Own Reason', '', 'Engineer', '', 'SAVED', 'MANUAL', 'PASS', 'Too far away');

select lives_ok(
  $$ select public.merge_duplicate_applications('e2000000-0000-4000-8000-000000000008', 'e2000000-0000-4000-8000-000000000009') $$,
  'two roles with decisions can be merged'
);
select is((select triage_decision from public.applications where id = 'e2000000-0000-4000-8000-000000000008'), 'PURSUE', 'the kept role keeps its decision');
select is((select triage_reason from public.applications where id = 'e2000000-0000-4000-8000-000000000008'), null, 'the kept decision does not take the duplicate''s reason');

select lives_ok(
  $$ select public.merge_duplicate_applications('e2000000-0000-4000-8000-00000000000a', 'e2000000-0000-4000-8000-00000000000b') $$,
  'two roles with decisions and reasons can be merged'
);
select is((select triage_reason from public.applications where id = 'e2000000-0000-4000-8000-00000000000a'), 'Good team', 'the kept decision keeps its own reason');

-- ---------------------------------------------------------------------------
-- Merging would give the kept role the same identity as a third role
-- ---------------------------------------------------------------------------

insert into public.applications (
  id, user_id, company, company_normalized, position, position_normalized,
  status, source, job_id
) values
  ('e2000000-0000-4000-8000-000000000005', auth.uid(), 'Clash Co', '', 'Third role', '', 'SAVED', 'MANUAL', 'REQ-7'),
  ('e2000000-0000-4000-8000-000000000006', auth.uid(), 'Clash Co', '', 'Kept role', '', 'SAVED', 'MANUAL', null),
  ('e2000000-0000-4000-8000-000000000007', auth.uid(), 'Another Name', '', 'Duplicate', '', 'SAVED', 'MANUAL', 'REQ-7');
insert into public.application_events (
  application_id, user_id, event_type, event_time, source, evidence
) values (
  'e2000000-0000-4000-8000-000000000007', auth.uid(), 'GENERAL_UPDATE', now(), 'MANUAL', 'Note that must stay put'
);

select throws_ok(
  $$ select public.merge_duplicate_applications('e2000000-0000-4000-8000-000000000006', 'e2000000-0000-4000-8000-000000000007') $$,
  '23505',
  null,
  'a merge that would collide with a third role is refused'
);
select is((select count(*) from public.applications where id = 'e2000000-0000-4000-8000-000000000007'), 1::bigint, 'a refused merge keeps the duplicate');
select is((select job_id from public.applications where id = 'e2000000-0000-4000-8000-000000000006'), null, 'a refused merge leaves the kept role unchanged');
select is((select count(*) from public.application_events where application_id = 'e2000000-0000-4000-8000-000000000007'), 1::bigint, 'a refused merge moves nothing');

select * from finish();
rollback;
