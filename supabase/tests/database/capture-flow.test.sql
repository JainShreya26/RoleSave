-- The server side of saving a job and marking it as applied.

begin;

create extension if not exists pgtap with schema extensions;
select plan(62);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-4000-8000-00000000000a', 'authenticated', 'authenticated', 'flow-a@example.com', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b0000000-0000-4000-8000-00000000000b', 'authenticated', 'authenticated', 'flow-b@example.com', '', now(), '{}', '{}', now(), now());

create temp table flow_sessions (
  label text primary key,
  job_id uuid,
  application_id uuid,
  document_id uuid,
  temporary_storage_path text,
  capture_status text,
  application_reused boolean,
  application_company text,
  application_position text
);
grant all on flow_sessions to authenticated;

create function pg_temp.start_session(p_label text, p_url text, p_key uuid, p_company text default 'Flow Co', p_position text default 'Engineer', p_job_id text default null)
returns void
language sql
as $$
  insert into flow_sessions
  select p_label, job_id, application_id, document_id, temporary_storage_path, capture_status::text,
    application_reused, application_company, application_position
  from public.create_capture_session(p_company, p_position, p_url, now(), p_key, p_job_id);
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-00000000000a', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

-- ---------------------------------------------------------------------------
-- A first save, from session to queue
-- ---------------------------------------------------------------------------

select pg_temp.start_session('new', 'https://flow.example.com/jobs/1', 'c0000000-0000-4000-8000-000000000001');

select is((select application_reused from flow_sessions where label = 'new'), false, 'a new posting is not reused');
select is((select application_company from flow_sessions where label = 'new'), 'Flow Co', 'the session names the company');
select is((select application_position from flow_sessions where label = 'new'), 'Engineer', 'the session names the position');
select is((select capture_status from flow_sessions where label = 'new'), 'PENDING', 'a new session is pending');
select ok(public.retry_capture_upload((select job_id from flow_sessions where label = 'new')), 'a new session may upload');
select is(
  (select available_at from public.capture_jobs where id = (select job_id from flow_sessions where label = 'new')),
  null,
  'the worker cannot claim a capture before its upload finishes'
);
select throws_ok(
  $$select public.finalize_capture_upload((select job_id from flow_sessions where label = 'new'))$$,
  'Temporary capture upload was not found',
  'a capture cannot be queued without its file'
);

reset role;
insert into storage.objects (bucket_id, name, owner_id)
select 'temporary-captures', temporary_storage_path, 'a0000000-0000-4000-8000-00000000000a'
from flow_sessions where label = 'new';
set local role authenticated;

select ok(public.finalize_capture_upload((select job_id from flow_sessions where label = 'new')), 'an uploaded capture can be queued');
select isnt(
  (select available_at from public.capture_jobs where id = (select job_id from flow_sessions where label = 'new')),
  null,
  'a queued capture is available to the worker'
);
select ok(
  not public.retry_capture_upload((select job_id from flow_sessions where label = 'new')),
  'a queued capture does not upload again'
);

-- ---------------------------------------------------------------------------
-- Saving a posting that is already tracked
-- ---------------------------------------------------------------------------

select pg_temp.start_session('same-key', 'https://flow.example.com/jobs/1', 'c0000000-0000-4000-8000-000000000001');
select is(
  (select job_id from flow_sessions where label = 'same-key'),
  (select job_id from flow_sessions where label = 'new'),
  'a retry with the same key continues the same session'
);

select pg_temp.start_session('same-posting', 'https://flow.example.com/jobs/1?utm_source=x', 'c0000000-0000-4000-8000-000000000002', 'Typed Co', 'Typed Role');
select is((select application_reused from flow_sessions where label = 'same-posting'), true, 'the same posting is reused');
select is(
  (select application_id from flow_sessions where label = 'same-posting'),
  (select application_id from flow_sessions where label = 'new'),
  'the same posting does not create a second application'
);
select is((select application_company from flow_sessions where label = 'same-posting'), 'Flow Co', 'a reused session names the saved company, not the typed one');
select is((select application_position from flow_sessions where label = 'same-posting'), 'Engineer', 'a reused session names the saved position, not the typed one');

-- ---------------------------------------------------------------------------
-- The same web address is the same posting, unless job IDs say otherwise
-- ---------------------------------------------------------------------------

select pg_temp.start_session('with-id', 'https://url-match.example.com/jobs/1?utm_source=first', 'c0000000-0000-4000-8000-000000000010', 'Url Co', 'Analyst', 'REQ-1');
select pg_temp.start_session('without-id', 'https://url-match.example.com/jobs/2', 'c0000000-0000-4000-8000-000000000011', 'Plain Co', 'Analyst');

select is(
  public.find_existing_application('https://url-match.example.com/jobs/1?ref=linkedin', 'Typed Co', null),
  (select application_id from flow_sessions where label = 'with-id'),
  'the same URL with no job ID finds a role that has one, whatever the company'
);
select is(
  public.find_existing_application('https://url-match.example.com/jobs/1', 'Renamed Co', 'REQ-1'),
  (select application_id from flow_sessions where label = 'with-id'),
  'the same URL and job ID finds the role after a company rename'
);
select is(
  public.find_existing_application('https://url-match.example.com/jobs/2', 'Plain Co', 'REQ-2'),
  (select application_id from flow_sessions where label = 'without-id'),
  'the same URL with a job ID finds a role that has none'
);
select is(
  public.find_existing_application('https://url-match.example.com/jobs/1', 'Url Co', 'REQ-9'),
  null,
  'the same URL with a different job ID is a different job'
);
select is(
  public.find_existing_application('https://url-match.example.com/jobs/3', 'Url Co', null),
  null,
  'a different URL is a different job'
);

select pg_temp.start_session('shared-a', 'https://url-match.example.com/board', 'c0000000-0000-4000-8000-000000000012', 'Board Co', 'First', 'REQ-101');
select pg_temp.start_session('shared-b', 'https://url-match.example.com/board', 'c0000000-0000-4000-8000-000000000013', 'Board Co', 'Second', 'REQ-102');
select isnt(
  (select application_id from flow_sessions where label = 'shared-a'),
  (select application_id from flow_sessions where label = 'shared-b'),
  'two job IDs on one URL make two roles'
);
select is(
  public.find_existing_application('https://url-match.example.com/board', 'Board Co', null),
  null,
  'with several roles at one URL, none is guessed'
);

select pg_temp.start_session('extension-resave', 'https://url-match.example.com/jobs/1', 'c0000000-0000-4000-8000-000000000014', 'Detected Co', 'Detected Role');
select is((select application_reused from flow_sessions where label = 'extension-resave'), true, 'a capture of the same URL reuses the role');
select is(
  (select application_id from flow_sessions where label = 'extension-resave'),
  (select application_id from flow_sessions where label = 'with-id'),
  'it attaches to the role that already exists'
);
select is((select application_company from flow_sessions where label = 'extension-resave'), 'Url Co', 'and names that role, not what the page said');

select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-00000000000b', true);
select is(public.find_existing_application('https://url-match.example.com/jobs/1', 'Url Co', null), null, 'another account does not match');
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-00000000000a', true);
select ok(
  not has_function_privilege('authenticated', 'public.find_matching_application(uuid,text,text,text)', 'EXECUTE'),
  'users cannot search another account directly'
);

-- ---------------------------------------------------------------------------
-- A failed upload, then a retry
-- ---------------------------------------------------------------------------

select pg_temp.start_session('failed', 'https://flow.example.com/jobs/2', 'c0000000-0000-4000-8000-000000000003');
select ok(public.fail_capture_upload((select job_id from flow_sessions where label = 'failed'), 'Upload broke'), 'an upload failure is recorded');
select is((select status::text from public.capture_jobs where id = (select job_id from flow_sessions where label = 'failed')), 'FAILED', 'the job is failed');
select is((select capture_status::text from public.documents where id = (select document_id from flow_sessions where label = 'failed')), 'FAILED', 'the document is failed');
select ok(public.retry_capture_upload((select job_id from flow_sessions where label = 'failed')), 'a failed capture can be retried');
select is((select status::text from public.capture_jobs where id = (select job_id from flow_sessions where label = 'failed')), 'PENDING', 'a retry returns the job to pending');
select is((select capture_status::text from public.documents where id = (select document_id from flow_sessions where label = 'failed')), 'PENDING', 'a retry returns the document to pending');

-- ---------------------------------------------------------------------------
-- Capturing again after a failed capture's file expired
-- ---------------------------------------------------------------------------

select pg_temp.start_session('expired', 'https://flow.example.com/jobs/3', 'c0000000-0000-4000-8000-000000000004');
select public.fail_capture_upload((select job_id from flow_sessions where label = 'expired'), 'Upload broke');

reset role;
update public.documents set temporary_storage_path = null
where id = (select document_id from flow_sessions where label = 'expired');
set local role authenticated;

select pg_temp.start_session('recaptured', 'https://flow.example.com/jobs/3', 'c0000000-0000-4000-8000-000000000005');
select is(
  (select job_id from flow_sessions where label = 'recaptured'),
  (select job_id from flow_sessions where label = 'expired'),
  'capturing again reuses the failed job'
);
select is(
  (select temporary_storage_path from flow_sessions where label = 'recaptured'),
  (select temporary_storage_path from flow_sessions where label = 'expired'),
  'capturing again gets its storage path back'
);
select is(
  (select temporary_storage_path from public.documents where id = (select document_id from flow_sessions where label = 'recaptured')),
  (select temporary_storage_path from flow_sessions where label = 'expired'),
  'the document records the restored path'
);
select ok(public.retry_capture_upload((select job_id from flow_sessions where label = 'recaptured')), 'an expired capture can upload again');

-- ---------------------------------------------------------------------------
-- Saves that never finished
-- ---------------------------------------------------------------------------

select pg_temp.start_session('abandoned', 'https://flow.example.com/jobs/4', 'c0000000-0000-4000-8000-000000000006');
select pg_temp.start_session('recent', 'https://flow.example.com/jobs/5', 'c0000000-0000-4000-8000-000000000007');
select pg_temp.start_session('queued', 'https://flow.example.com/jobs/6', 'c0000000-0000-4000-8000-000000000008');
select pg_temp.start_session('resumed', 'https://flow.example.com/jobs/7', 'c0000000-0000-4000-8000-000000000009');

reset role;
alter table public.capture_jobs disable trigger capture_jobs_set_updated_at;
update public.capture_jobs set updated_at = now() - interval '31 minutes'
where id in (select job_id from flow_sessions where label in ('abandoned', 'queued', 'resumed'));
update public.capture_jobs set available_at = now()
where id = (select job_id from flow_sessions where label = 'queued');
alter table public.capture_jobs enable trigger capture_jobs_set_updated_at;
set local role authenticated;

select ok(public.retry_capture_upload((select job_id from flow_sessions where label = 'resumed')), 'an old upload can be resumed');
select ok(
  not has_function_privilege('authenticated', 'public.expire_abandoned_capture_uploads()', 'EXECUTE'),
  'users cannot expire uploads'
);

reset role;
select ok(has_function_privilege('service_role', 'public.expire_abandoned_capture_uploads()', 'EXECUTE'), 'the worker can expire uploads');
select ok(public.expire_abandoned_capture_uploads() >= 1, 'abandoned uploads are expired');
select is((select status::text from public.capture_jobs where id = (select job_id from flow_sessions where label = 'abandoned')), 'FAILED', 'an abandoned upload fails');
select is((select capture_status::text from public.documents where id = (select document_id from flow_sessions where label = 'abandoned')), 'FAILED', 'its document fails too');
select isnt((select failed_at from public.capture_jobs where id = (select job_id from flow_sessions where label = 'abandoned')), null, 'it enters failed-capture retention');
select matches((select last_error from public.capture_jobs where id = (select job_id from flow_sessions where label = 'abandoned')), 'did not finish', 'it says what happened');
select is((select status::text from public.capture_jobs where id = (select job_id from flow_sessions where label = 'recent')), 'PENDING', 'a recent upload is left alone');
select is((select status::text from public.capture_jobs where id = (select job_id from flow_sessions where label = 'queued')), 'PENDING', 'a queued capture is left alone');
select is((select status::text from public.capture_jobs where id = (select job_id from flow_sessions where label = 'resumed')), 'PENDING', 'a resumed upload is left alone');
set local role authenticated;

-- ---------------------------------------------------------------------------
-- Marking as applied
-- ---------------------------------------------------------------------------

select ok(public.mark_application_applied((select application_id from flow_sessions where label = 'new')), 'a saved application can be marked as applied');
select is((select status::text from public.applications where id = (select application_id from flow_sessions where label = 'new')), 'APPLIED', 'its status changes');
select isnt((select applied_at from public.applications where id = (select application_id from flow_sessions where label = 'new')), null, 'it records when');
select is(
  (select count(*) from public.application_events where application_id = (select application_id from flow_sessions where label = 'new') and event_type = 'MARKED_AS_APPLIED'),
  1::bigint,
  'it adds one timeline event'
);
select ok(public.mark_application_applied((select application_id from flow_sessions where label = 'new')), 'marking it again succeeds');
select is(
  (select count(*) from public.application_events where application_id = (select application_id from flow_sessions where label = 'new') and event_type = 'MARKED_AS_APPLIED'),
  1::bigint,
  'marking it again adds no event'
);

reset role;
insert into public.applications (id, user_id, company, company_normalized, position, position_normalized, status, source)
values ('d0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'Later Co', '', 'Engineer', '', 'INTERVIEW', 'MANUAL');
set local role authenticated;

select ok(not public.mark_application_applied('d0000000-0000-4000-8000-000000000001'), 'an application past Applied is refused');
select is((select status::text from public.applications where id = 'd0000000-0000-4000-8000-000000000001'), 'INTERVIEW', 'and it is not downgraded');
select ok(not public.mark_application_applied('d0000000-0000-4000-8000-000000000099'), 'a missing application is refused');

select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-00000000000b', true);
select ok(not public.mark_application_applied((select application_id from flow_sessions where label = 'failed')), 'another account''s application is refused');

reset role;
select is((select status::text from public.applications where id = (select application_id from flow_sessions where label = 'failed')), 'SAVED', 'and it is not changed');

-- ---------------------------------------------------------------------------
-- A saved role has no applied date
-- ---------------------------------------------------------------------------

select throws_ok(
  $$update public.applications set applied_at = now() where id = (select application_id from flow_sessions where label = 'failed')$$,
  '23514',
  null,
  'a saved role cannot be given an applied date'
);
select lives_ok(
  $$update public.applications set status = 'APPLIED', applied_at = now() where id = (select application_id from flow_sessions where label = 'failed')$$,
  'an applied role can have one'
);
select throws_ok(
  $$update public.applications set status = 'SAVED' where id = (select application_id from flow_sessions where label = 'failed')$$,
  '23514',
  null,
  'going back to saved must clear it'
);

select * from finish();
rollback;
