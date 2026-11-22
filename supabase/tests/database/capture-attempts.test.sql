begin;

create extension if not exists pgtap with schema extensions;
select plan(28);

insert into auth.users (id, email)
values ('b7100000-0000-4000-8000-000000000001', 'capture-attempts@example.test');

insert into public.applications (id, user_id, company, position, original_url, status, source)
values (
  'b7100000-0000-4000-8000-000000000002', 'b7100000-0000-4000-8000-000000000001',
  'Worker Attempts Co', 'Engineer', 'https://worker.example.test/jobs/2', 'SAVED', 'EXTENSION'
);

create temp table attempt_fixtures as
with ids as (
  select label, gen_random_uuid() as job_id, gen_random_uuid() as document_id,
    'b7100000-0000-4000-8000-000000000001'::uuid as user_id,
    'b7100000-0000-4000-8000-000000000002'::uuid as application_id
  from (values ('reclaimed'), ('failure'), ('legacy-expired')) as cases(label)
)
select *, user_id || '/' || application_id || '/job-description-' || document_id || '.pdf' as storage_path,
  user_id || '/' || application_id || '/' || document_id || '.mhtml' as temporary_storage_path,
  (case when label = 'legacy-expired' then 'PROCESSING' else 'PENDING' end)::public.capture_status as status
from ids;

insert into public.documents (
  id, application_id, user_id, capture_status, storage_path, temporary_storage_path, captured_at
)
select document_id, application_id, user_id, status, storage_path, temporary_storage_path, now()
from attempt_fixtures;

insert into public.capture_jobs (
  id, document_id, application_id, user_id, idempotency_key, status, attempt_count, available_at, updated_at
)
select job_id, document_id, application_id, user_id, gen_random_uuid(), status,
  case when label = 'legacy-expired' then 3 else 0 end,
  case when label = 'reclaimed' then '-infinity'::timestamptz end,
  now() - interval '1 hour'
from attempt_fixtures;

create temp table attempts as
select 'first'::text as worker, c.*
from public.claim_capture_attempt() c join attempt_fixtures f on f.job_id = c.job_id
where f.label = 'reclaimed';
select is((select count(*) from attempts), 1::bigint, 'the worker claims the queued capture');
select is(d.storage_path, f.storage_path, 'claiming does not publish an output path')
from public.documents d join attempt_fixtures f on f.document_id = d.id where f.label = 'reclaimed';
select is(d.capture_status::text, 'FAILED', 'an expired pre-migration third attempt still fails')
from public.documents d join attempt_fixtures f on f.document_id = d.id where f.label = 'legacy-expired';
select is(public.complete_capture_attempt(job_id, attempt_id, 10, 'first-checksum'), false, 'completion requires the attempt PDF')
from attempts where worker = 'first';

insert into storage.objects (bucket_id, name)
select 'job-descriptions', output_storage_path from attempts where worker = 'first';
update public.capture_jobs set lease_expires_at = now() - interval '1 minute'
where id = (select job_id from attempts where worker = 'first');

select is(public.complete_capture_attempt(job_id, attempt_id, 10, 'first-checksum'), false, 'an expired claim cannot publish even before recovery')
from attempts where worker = 'first';
select is(public.fail_capture_attempt(job_id, attempt_id, 'Late failure'), false, 'an expired claim cannot fail the job')
from attempts where worker = 'first';
select public.queue_abandoned_capture_outputs();
select ok(not exists (
  select 1 from public.capture_storage_deletions q join attempts a on a.output_storage_path = q.storage_path
  where a.worker = 'first'
), 'cleanup waits for recovery to release an expired claim');

insert into attempts
select 'second', c.*
from public.claim_capture_attempt() c join attempt_fixtures f on f.job_id = c.job_id
where f.label = 'reclaimed';
select is((select count(*) from attempts), 2::bigint, 'a worker can reclaim the expired job');
select isnt(a.attempt_id, b.attempt_id, 'reclaiming assigns a new attempt ID')
from attempts a, attempts b where a.worker = 'first' and b.worker = 'second';
select isnt(a.output_storage_path, b.output_storage_path, 'the attempts write to separate PDF keys')
from attempts a, attempts b where a.worker = 'first' and b.worker = 'second';
select is(public.complete_capture_attempt(job_id, attempt_id, 10, 'first-checksum'), false, 'the old worker cannot publish during the new attempt')
from attempts where worker = 'first';
select is(public.fail_capture_attempt(job_id, attempt_id, 'Late failure'), false, 'the old worker cannot interrupt the new attempt')
from attempts where worker = 'first';

insert into storage.objects (bucket_id, name)
select 'job-descriptions', output_storage_path from attempts where worker = 'second'
union all
select 'job-descriptions', storage_path from attempt_fixtures where label = 'reclaimed';

select public.queue_abandoned_capture_outputs();
select ok(exists (
  select 1 from public.capture_storage_deletions q join attempts a on a.output_storage_path = q.storage_path
  where a.worker = 'first'
), 'the released attempt PDF is queued for deletion');
select ok(not exists (
  select 1 from public.capture_storage_deletions q join attempts a on a.output_storage_path = q.storage_path
  where a.worker = 'second'
), 'the current attempt PDF is protected before publication');

select ok(public.complete_capture_attempt(job_id, attempt_id, 42, 'winner-checksum'), 'the current attempt publishes its PDF')
from attempts where worker = 'second';
select ok(public.complete_capture_attempt(job_id, attempt_id, 42, 'winner-checksum'), 'the same completion can be acknowledged again')
from attempts where worker = 'second';
select is(public.complete_capture_attempt(job_id, attempt_id, 43, 'different-checksum'), false, 'conflicting completion metadata is refused')
from attempts where worker = 'second';
select is(public.fail_capture_attempt(job_id, attempt_id, 'Lost acknowledgement'), false, 'failure cannot undo a committed result')
from attempts where worker = 'second';
select is(d.storage_path, a.output_storage_path, 'the document points at the winning PDF key')
from public.documents d join attempts a on a.document_id = d.id where a.worker = 'second';
select is(d.checksum_sha256, 'winner-checksum', 'the document records the winning checksum')
from public.documents d join attempts a on a.document_id = d.id where a.worker = 'second';
select is(
  (select count(*) from public.application_events e join attempt_fixtures f on e.application_id = f.application_id
    where f.label = 'reclaimed' and e.event_type = 'JD_SAVED'),
  1::bigint, 'retrying completion adds only one timeline event'
);
select ok(exists (
  select 1 from public.capture_storage_deletions q join attempt_fixtures f on f.storage_path = q.storage_path
  where f.label = 'reclaimed'
), 'publication retires any PDF left at the legacy key');
select public.queue_abandoned_capture_outputs();
select ok(not exists (
  select 1 from public.capture_storage_deletions q join attempts a on a.output_storage_path = q.storage_path
  where a.worker = 'second'
), 'cleanup preserves the published PDF');

update public.capture_jobs set available_at = '-infinity' where id = (select job_id from attempt_fixtures where label = 'failure');
insert into attempts
select 'failure', c.*
from public.claim_capture_attempt() c join attempt_fixtures f on f.job_id = c.job_id
where f.label = 'failure';
select ok(public.fail_capture_attempt(job_id, attempt_id, 'Renderer error'), 'the current attempt can report a genuine failure')
from attempts where worker = 'failure';
select ok(j.status = 'PENDING' and j.attempt_id is null and j.available_at > clock_timestamp() and j.last_error = 'Renderer error',
  'failure releases the claim and schedules an automatic retry with the error')
from public.capture_jobs j join attempts a on a.job_id = j.id where a.worker = 'failure';

update public.capture_jobs set available_at = '-infinity' where id = (select job_id from attempt_fixtures where label = 'failure');
insert into attempts
select 'hopeless', c.*
from public.claim_capture_attempt() c join attempt_fixtures f on f.job_id = c.job_id
where f.label = 'failure';
select ok(public.fail_capture_attempt(job_id, attempt_id, 'The saved page had no readable text.', false),
  'the worker can report a failure that retrying cannot fix')
from attempts where worker = 'hopeless';
select ok(j.status = 'FAILED' and j.attempt_count < 3 and j.available_at is null,
  'a failure that retrying cannot fix fails the job at once')
from public.capture_jobs j join attempts a on a.job_id = j.id where a.worker = 'hopeless';
select is(
  (select d.capture_status from public.documents d join attempt_fixtures f on f.document_id = d.id where f.label = 'failure'),
  'FAILED'::public.capture_status, 'the role shows the failure at once'
);

select * from finish();
rollback;
