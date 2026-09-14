begin;

create extension if not exists pgtap with schema extensions;
select plan(23);

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

insert into public.email_accounts (
  id, user_id, provider, provider_account_id, email_address
) values
  ('11500000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'FORWARDING', 'token-a', 'jobs+a@example.test'),
  ('23000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'FORWARDING', 'token-b', 'jobs+b@example.test');

insert into public.inbound_email_jobs (
  id, user_id, email_account_id, provider_message_id, storage_path, status, attempt_count
) values
  ('11600000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '11500000-0000-4000-8000-000000000001', 'message-a', 'a/message.eml', 'FAILED', 3),
  ('23200000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '23000000-0000-4000-8000-000000000002', 'message-b', 'b/message.eml', 'FAILED', 3);

insert into public.email_events (
  id, email_job_id, user_id, email_account_id, provider_message_id, subject,
  received_at, classification, classification_confidence, metadata_score, evidence
) values
  ('11700000-0000-4000-8000-000000000001', '11600000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '11500000-0000-4000-8000-000000000001', 'message-a', 'A subject', now(), 'UNKNOWN_EMAIL_EVENT', 0.5, 1, 'A evidence'),
  ('23400000-0000-4000-8000-000000000002', '23200000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '23000000-0000-4000-8000-000000000002', 'message-b', 'B subject', now(), 'UNKNOWN_EMAIL_EVENT', 0.5, 1, 'B evidence');

select ok(
  public.set_email_review_suggestions(
    '11700000-0000-4000-8000-000000000001',
    array[
      '11900000-0000-4000-8000-000000000009'::uuid,
      '22000000-0000-4000-8000-000000000002'::uuid,
      '11000000-0000-4000-8000-000000000001'::uuid,
      '11900000-0000-4000-8000-000000000009'::uuid
    ],
    'Ranked suggestions',
    0.5
  ),
  'service role can store review suggestions'
);
select is(
  (
    select suggested_application_ids
    from public.review_tasks
    where email_event_id = '11700000-0000-4000-8000-000000000001'
  ),
  array[
    '11900000-0000-4000-8000-000000000009'::uuid,
    '11000000-0000-4000-8000-000000000001'::uuid
  ],
  'review suggestions preserve ranking, remove duplicates, and exclude other users'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is((select count(*) from public.applications), 2::bigint, 'user A sees only their applications');
select is((select count(*) from public.application_events), 1::bigint, 'user A sees only their timeline event');
select is((select count(*) from public.documents), 1::bigint, 'user A sees only their document');
select is((select count(*) from public.capture_jobs), 1::bigint, 'user A sees only their capture job');
select is((select count(*) from public.email_accounts), 1::bigint, 'user A sees only their email account');
select is((select count(*) from public.inbound_email_jobs), 1::bigint, 'user A sees only their inbound email job');
select is((select count(*) from public.email_events), 1::bigint, 'user A sees only their email event');
select is((select count(*) from public.review_tasks), 1::bigint, 'user A sees only their review task');
select is((select company from public.applications where id = '22000000-0000-4000-8000-000000000002'), null::text, 'user A cannot read user B application by id');
select is(public.retry_failed_capture('22400000-0000-4000-8000-000000000002'), false, 'user A cannot replay user B capture');
select is(public.retry_failed_email_job('23200000-0000-4000-8000-000000000002'), false, 'user A cannot replay user B email');
select ok(
  public.resolve_email_review_task(
    (select id from public.review_tasks where email_event_id = '11700000-0000-4000-8000-000000000001'),
    '11900000-0000-4000-8000-000000000009'
  ),
  'user A can resolve their email review'
);
select ok(
  public.reassign_email_event_match(
    '11700000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-000000000001'
  ),
  'user A can reassign their matched email'
);
select is(
  (select application_id from public.email_events where id = '11700000-0000-4000-8000-000000000001'),
  '11000000-0000-4000-8000-000000000001'::uuid,
  'reassignment moves the email to the selected application'
);
select is(
  public.reassign_email_event_match(
    '11700000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000002'
  ),
  false,
  'user A cannot reassign an email to user B application'
);
select ok(
  public.undo_email_event_match('11700000-0000-4000-8000-000000000001'),
  'user A can undo their email match'
);
select is(
  (select application_id from public.email_events where id = '11700000-0000-4000-8000-000000000001'),
  null::uuid,
  'undo detaches the email'
);
select is(
  (select status::text from public.review_tasks where email_event_id = '11700000-0000-4000-8000-000000000001'),
  'OPEN',
  'undo reopens review'
);

select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
select is((select count(*) from public.applications), 1::bigint, 'user B sees only their application');
select is((select count(*) from public.capture_jobs), 1::bigint, 'user B sees only their capture job');
select is((select count(*) from public.inbound_email_jobs), 1::bigint, 'user B sees only their inbound email job');

select * from finish();
rollback;
