create table public.email_events (
  id uuid primary key default gen_random_uuid(),
  email_job_id uuid not null unique references public.inbound_email_jobs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email_account_id uuid not null references public.email_accounts(id) on delete cascade,
  application_id uuid references public.applications(id) on delete set null,
  provider_message_id text not null,
  message_id text,
  thread_id text,
  sender text,
  sender_name text,
  sender_domain text,
  subject text not null,
  received_at timestamptz not null,
  classification text not null check (classification in (
    'APPLICATION_CONFIRMED', 'ASSESSMENT_REQUESTED', 'INTERVIEW_REQUESTED',
    'OFFER_RECEIVED', 'REJECTION_RECEIVED', 'UNKNOWN_EMAIL_EVENT', 'NOT_JOB_RELATED'
  )),
  extracted_company text,
  extracted_position text,
  extracted_job_id text,
  meeting_url text,
  classification_confidence numeric not null
    check (classification_confidence between 0 and 1),
  metadata_score integer not null,
  evidence text not null,
  created_at timestamptz not null default now(),
  unique (email_account_id, provider_message_id)
);

create index email_events_user_received_idx
  on public.email_events(user_id, received_at desc);
create index email_events_unmatched_idx
  on public.email_events(user_id, classification, received_at desc)
  where application_id is null and classification <> 'NOT_JOB_RELATED';

alter table public.email_events enable row level security;

create policy email_events_select_own on public.email_events
for select to authenticated using ((select auth.uid()) = user_id);

grant select on public.email_events to authenticated;

create function public.claim_inbound_email_job()
returns table (
  job_id uuid,
  user_id uuid,
  email_account_id uuid,
  provider_message_id text,
  storage_path text
)
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_job_id uuid;
begin
  select inbound_email_jobs.id into v_job_id
  from public.inbound_email_jobs
  where status = 'PENDING' and available_at is not null
  order by created_at
  for update skip locked
  limit 1;

  if v_job_id is null then
    return;
  end if;

  update public.inbound_email_jobs
  set status = 'PROCESSING', attempt_count = attempt_count + 1, last_error = null
  where id = v_job_id;

  return query
  select
    inbound_email_jobs.id,
    inbound_email_jobs.user_id,
    inbound_email_jobs.email_account_id,
    inbound_email_jobs.provider_message_id,
    inbound_email_jobs.storage_path
  from public.inbound_email_jobs
  where inbound_email_jobs.id = v_job_id;
end;
$$;

create function public.complete_inbound_email_job(
  p_job_id uuid,
  p_message_id text,
  p_thread_id text,
  p_sender text,
  p_sender_name text,
  p_sender_domain text,
  p_subject text,
  p_received_at timestamptz,
  p_classification text,
  p_extracted_job_id text,
  p_meeting_url text,
  p_classification_confidence numeric,
  p_metadata_score integer,
  p_evidence text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_job public.inbound_email_jobs%rowtype;
begin
  select * into v_job
  from public.inbound_email_jobs
  where id = p_job_id and status = 'PROCESSING'
  for update;

  if v_job.id is null then
    return false;
  end if;

  insert into public.email_events (
    email_job_id, user_id, email_account_id, provider_message_id,
    message_id, thread_id, sender, sender_name, sender_domain, subject,
    received_at, classification, extracted_job_id, meeting_url,
    classification_confidence, metadata_score, evidence
  ) values (
    v_job.id, v_job.user_id, v_job.email_account_id, v_job.provider_message_id,
    nullif(trim(p_message_id), ''), nullif(trim(p_thread_id), ''),
    nullif(trim(p_sender), ''), nullif(trim(p_sender_name), ''),
    nullif(trim(p_sender_domain), ''), left(coalesce(p_subject, ''), 1000),
    p_received_at, p_classification, nullif(trim(p_extracted_job_id), ''),
    nullif(trim(p_meeting_url), ''), p_classification_confidence,
    p_metadata_score, left(p_evidence, 1000)
  )
  on conflict (email_job_id) do nothing;

  update public.inbound_email_jobs
  set status = 'COMPLETE', completed_at = now(), last_error = null
  where id = v_job.id;

  return true;
end;
$$;

create function public.fail_inbound_email_job(p_job_id uuid, p_error text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
begin
  update public.inbound_email_jobs
  set status = 'FAILED', last_error = left(coalesce(p_error, 'Email processing failed'), 2000)
  where id = p_job_id and status = 'PROCESSING';

  return found;
end;
$$;

revoke all on function public.claim_inbound_email_job() from public;
revoke all on function public.complete_inbound_email_job(
  uuid, text, text, text, text, text, text, timestamptz, text, text, text,
  numeric, integer, text
) from public;
revoke all on function public.fail_inbound_email_job(uuid, text) from public;
grant execute on function public.claim_inbound_email_job() to service_role;
grant execute on function public.complete_inbound_email_job(
  uuid, text, text, text, text, text, text, timestamptz, text, text, text,
  numeric, integer, text
) to service_role;
grant execute on function public.fail_inbound_email_job(uuid, text) to service_role;
