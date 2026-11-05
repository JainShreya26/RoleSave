begin;

create extension if not exists pgtap with schema extensions;
select plan(14);

select ok(
  has_table_privilege('service_role', 'public.capture_jobs', 'INSERT'),
  'service role can create capture jobs'
);
select ok(
  not has_table_privilege('authenticated', 'public.capture_jobs', 'INSERT'),
  'authenticated users cannot insert capture jobs directly'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'owner-a@example.test', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'owner-b@example.test', '', now(), '{}', '{}', now(), now());

insert into public.applications (
  id, user_id, company, company_normalized, position, position_normalized, status, source
) values
  ('11000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Owner A Co', '', 'Engineer A', '', 'SAVED', 'MANUAL'),
  ('11900000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000001', 'Owner A Second Co', '', 'Engineer A2', '', 'SAVED', 'MANUAL'),
  ('22000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'Owner B Co', '', 'Engineer B', '', 'SAVED', 'MANUAL');

insert into public.application_events (
  id, application_id, user_id, event_type, event_time, source, evidence
) values
  ('11100000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'JD_SAVED', now(), 'MANUAL', 'A'),
  ('22200000-0000-4000-8000-000000000002', '22000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'JD_SAVED', now(), 'MANUAL', 'B');

insert into public.documents (
  id, application_id, user_id, storage_path, temporary_storage_path, capture_status
) values
  ('11200000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'a/job.pdf', 'a/source.mhtml', 'FAILED'),
  ('22400000-0000-4000-8000-000000000002', '22000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'b/job.pdf', 'b/source.mhtml', 'FAILED');

insert into public.capture_jobs (
  id, user_id, application_id, document_id, idempotency_key, status, attempt_count
) values
  ('11300000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', '11200000-0000-4000-8000-000000000001', '11400000-0000-4000-8000-000000000001', 'FAILED', 3),
  ('22600000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '22000000-0000-4000-8000-000000000002', '22400000-0000-4000-8000-000000000002', '22800000-0000-4000-8000-000000000002', 'FAILED', 3);

insert into public.application_actions (
  id, application_id, user_id, title, due_at
) values
  ('11500000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Follow up A', now() + interval '1 day'),
  ('22700000-0000-4000-8000-000000000002', '22000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'Follow up B', now() + interval '1 day');

insert into public.application_attachments (
  id, application_id, user_id, file_name, mime_type, file_size_bytes, storage_path
) values
  ('11600000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'resume-a.pdf', 'application/pdf', 100,
    '10000000-0000-4000-8000-000000000001/resume-a.pdf'),
  ('22900000-0000-4000-8000-000000000002', '22000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'resume-b.pdf', 'application/pdf', 100,
    '20000000-0000-4000-8000-000000000002/resume-b.pdf');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is((select count(*) from public.applications), 2::bigint, 'user A sees only their applications');
select is((select count(*) from public.application_events), 1::bigint, 'user A sees only their timeline event');
select is((select count(*) from public.documents), 1::bigint, 'user A sees only their document');
select is((select count(*) from public.capture_jobs), 1::bigint, 'user A sees only their capture job');
select is((select count(*) from public.application_actions), 1::bigint, 'user A sees only their actions');
select is((select count(*) from public.application_attachments), 1::bigint, 'user A sees only their application files');
select is((select company from public.applications where id = '22000000-0000-4000-8000-000000000002'), null::text, 'user A cannot read user B application by id');
select is(public.retry_failed_capture('22400000-0000-4000-8000-000000000002'), false, 'user A cannot replay user B capture');

select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
select is((select count(*) from public.applications), 1::bigint, 'user B sees only their application');
select is((select count(*) from public.capture_jobs), 1::bigint, 'user B sees only their capture job');
select is((select count(*) from public.application_actions), 1::bigint, 'user B sees only their actions');
select is((select count(*) from public.application_attachments), 1::bigint, 'user B sees only their application files');

select * from finish();
rollback;
