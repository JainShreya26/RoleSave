begin;

create extension if not exists pgtap with schema extensions;
select plan(18);

insert into auth.users (id, email)
values ('b7000000-0000-4000-8000-000000000001', 'worker-recovery@example.test');

insert into public.applications (id, user_id, company, position, original_url, status, source)
values (
  'b7000000-0000-4000-8000-000000000002', 'b7000000-0000-4000-8000-000000000001',
  'Worker Recovery Co', 'Engineer', 'https://worker.example.test/jobs/1', 'SAVED', 'EXTENSION'
);

create temp table worker_captures as
with cases as (
  select 'already-cleaned-' || n as label, false as has_source, 'FAILED'::public.capture_status as status
  from generate_series(1, 20) n
  union all values ('retire', true, 'FAILED'::public.capture_status), ('replay-first', true, 'FAILED'),
    ('abandoned-pdf', false, 'FAILED')
), ids as (
  select *, gen_random_uuid() as job_id, gen_random_uuid() as document_id, gen_random_uuid() as idempotency_key,
    'b7000000-0000-4000-8000-000000000001'::uuid as user_id,
    'b7000000-0000-4000-8000-000000000002'::uuid as application_id
  from cases
)
select *, user_id || '/old-folder/' || document_id || '.pdf' as storage_path,
  case when has_source then user_id || '/old-folder/' || document_id || '.mhtml' end as temporary_storage_path
from ids;

insert into public.documents (
  id, application_id, user_id, capture_status, storage_path, temporary_storage_path, original_url, captured_at
)
select document_id, application_id, user_id, status, storage_path, temporary_storage_path,
  'https://worker.example.test/jobs/1', now()
from worker_captures;

insert into public.capture_jobs (
  id, application_id, user_id, document_id, idempotency_key, status, attempt_count, failed_at, updated_at
)
select job_id, application_id, user_id, document_id, idempotency_key, status, 3,
  case when label like 'already-cleaned-%' then '1999-01-01'::timestamptz else '2000-01-01'::timestamptz end,
  now() - interval '1 hour'
from worker_captures;

insert into storage.objects (bucket_id, name, owner_id)
select 'temporary-captures', temporary_storage_path, user_id::text from worker_captures where has_source
union all
select 'job-descriptions', storage_path, user_id::text from worker_captures where label = 'abandoned-pdf';

grant select on worker_captures to authenticated;
create temp table recapture (job_id uuid, temporary_storage_path text);
grant select, insert on recapture to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b7000000-0000-4000-8000-000000000001', true);

select ok(public.retry_failed_capture(document_id), 'a replay can win the race before the source is retired')
from worker_captures where label = 'replay-first';
reset role;

select ok(
  not has_function_privilege('authenticated', 'public.queue_expired_capture_payloads(timestamptz)', 'EXECUTE'),
  'retiring captures requires the worker role'
);
select is(
  public.queue_expired_capture_payloads('2000-01-02'), 1,
  'twenty earlier pathless failures do not hide a still-retained source'
);
select is(
  (select d.temporary_storage_path from public.documents d join worker_captures f on f.document_id = d.id
    where f.label = 'retire'),
  null::text, 'retirement detaches the source before attempting storage deletion'
);
select is(q.storage_path, f.temporary_storage_path, 'the retired key remains queued until storage deletion succeeds')
from public.capture_storage_deletions q join worker_captures f on f.document_id = q.document_id
where f.label = 'retire';
select is(d.temporary_storage_path, f.temporary_storage_path, 'a source already requeued for conversion is preserved')
from public.documents d join worker_captures f on f.document_id = d.id where f.label = 'replay-first';

select * from public.purge_expired_operational_data(90);
select ok(exists (
  select 1 from public.capture_jobs j join worker_captures f on f.job_id = j.id where f.label = 'retire'
), 'metadata survives until the pending source deletion succeeds');
select ok(exists (
  select 1 from public.capture_storage_deletions q join worker_captures f on f.document_id = q.document_id
  where f.label = 'abandoned-pdf' and q.bucket_id = 'job-descriptions' and q.storage_path = f.storage_path
), 'purging a failed document also retires its uncommitted PDF');

set local role authenticated;
select is(public.retry_failed_capture(document_id), false, 'a retired source cannot be replayed even if the object is still present')
from worker_captures where label = 'retire';
select throws_ok(
  $$select public.retry_capture_upload(job_id) from worker_captures where label = 'retire'$$,
  'The temporary capture expired. Save the page again to start a new upload.',
  'an old upload session cannot restart after its key is retired'
);
insert into recapture
select r.job_id, r.temporary_storage_path
from worker_captures f, lateral public.create_capture_session(
  'Worker Recovery Co', 'Engineer', 'https://worker.example.test/jobs/1', now(), f.idempotency_key
) r
where f.label = 'retire';
select is(r.job_id, f.job_id, 'recapture keeps the same job')
from recapture r, worker_captures f where f.label = 'retire';
select isnt(r.temporary_storage_path, f.temporary_storage_path, 'the next upload cannot reuse the retired key')
from recapture r, worker_captures f where f.label = 'retire';
reset role;
select is(public.queue_expired_capture_payloads('2000-01-02'), 0, 'the session protects its new key while the client prepares');

set local role authenticated;
select ok(public.retry_capture_upload(job_id), 'the fresh upload can start') from recapture;
select is(j.attempt_count, 0, 'a fresh upload gets a new conversion retry budget')
from public.capture_jobs j join recapture r on r.job_id = j.id;
reset role;

insert into storage.objects (bucket_id, name, owner_id)
select 'temporary-captures', temporary_storage_path, 'b7000000-0000-4000-8000-000000000001' from recapture;
set local role authenticated;
select ok(public.finalize_capture_upload(job_id), 'the replacement source can be queued while the old deletion is pending')
from recapture;
delete from public.applications where id = 'b7000000-0000-4000-8000-000000000002';
select is((select count(*) from public.documents), 0::bigint, 'deleting a role still cascades to its documents');
reset role;
select ok(exists (
  select 1 from public.capture_storage_deletions q join worker_captures f on f.document_id = q.document_id
  where f.label = 'retire'
), 'a queued source deletion survives the role being deleted');

select * from finish();
rollback;
