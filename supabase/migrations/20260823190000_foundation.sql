create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create type public.application_status as enum (
  'SAVED', 'APPLIED', 'ASSESSMENT', 'INTERVIEW',
  'OFFER', 'REJECTED', 'WITHDRAWN', 'NEEDS_REVIEW'
);
create type public.application_source as enum ('EXTENSION', 'EMAIL', 'MANUAL');
create type public.event_source as enum ('EXTENSION', 'EMAIL', 'MANUAL', 'SYSTEM');
create type public.capture_status as enum ('PENDING', 'PROCESSING', 'COMPLETE', 'FAILED');
create type public.application_event_type as enum (
  'JD_SAVED', 'MARKED_AS_APPLIED', 'APPLICATION_CONFIRMED',
  'ASSESSMENT_REQUESTED', 'INTERVIEW_REQUESTED', 'INTERVIEW_SCHEDULED',
  'INTERVIEW_RESCHEDULED', 'OFFER_RECEIVED', 'REJECTION_RECEIVED',
  'APPLICATION_WITHDRAWN', 'GENERAL_UPDATE', 'MANUAL_CORRECTION',
  'UNKNOWN_EMAIL_EVENT'
);

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company text not null check (char_length(company) between 1 and 200),
  company_normalized text not null,
  position text not null check (char_length(position) between 1 and 300),
  position_normalized text not null,
  status public.application_status not null,
  source public.application_source not null,
  original_url text,
  original_domain text,
  job_id text,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index applications_user_status_idx on public.applications(user_id, status);
create index applications_position_trgm_idx on public.applications using gin(position_normalized gin_trgm_ops);

create table public.application_events (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type public.application_event_type not null,
  event_time timestamptz not null,
  source public.event_source not null,
  confidence numeric check (confidence between 0 and 1),
  evidence text,
  provider_message_id text,
  previous_status public.application_status,
  new_status public.application_status,
  created_at timestamptz not null default now()
);

create index application_events_application_time_idx
  on public.application_events(application_id, event_time desc);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  document_type text not null default 'JOB_DESCRIPTION'
    check (document_type = 'JOB_DESCRIPTION'),
  storage_path text not null unique,
  temporary_storage_path text,
  original_url text,
  mime_type text not null default 'application/pdf',
  file_size_bytes bigint check (file_size_bytes is null or file_size_bytes >= 0),
  checksum_sha256 text,
  capture_status public.capture_status not null,
  captured_at timestamptz,
  created_at timestamptz not null default now()
);

create index documents_application_idx on public.documents(application_id);

create function public.normalize_application_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.company := trim(new.company);
  new.position := trim(new.position);
  new.company_normalized := lower(regexp_replace(new.company, '\s+', ' ', 'g'));
  new.position_normalized := lower(regexp_replace(new.position, '\s+', ' ', 'g'));
  if new.original_url is not null then
    new.original_domain := lower(split_part(split_part(new.original_url, '://', 2), '/', 1));
  end if;
  return new;
end;
$$;

create trigger applications_normalize_before_write
before insert or update of company, position, original_url
on public.applications
for each row execute function public.normalize_application_fields();

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger applications_set_updated_at
before update on public.applications
for each row execute function public.set_updated_at();

alter table public.applications enable row level security;
alter table public.application_events enable row level security;
alter table public.documents enable row level security;

create policy applications_select_own on public.applications
for select to authenticated using ((select auth.uid()) = user_id);
create policy applications_insert_own on public.applications
for insert to authenticated with check ((select auth.uid()) = user_id);
create policy applications_update_own on public.applications
for update to authenticated using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy applications_delete_own on public.applications
for delete to authenticated using ((select auth.uid()) = user_id);

create policy application_events_select_own on public.application_events
for select to authenticated using ((select auth.uid()) = user_id);
create policy application_events_insert_own on public.application_events
for insert to authenticated with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.applications
    where applications.id = application_id and applications.user_id = (select auth.uid())
  )
);

create policy documents_select_own on public.documents
for select to authenticated using ((select auth.uid()) = user_id);
create policy documents_insert_own on public.documents
for insert to authenticated with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.applications
    where applications.id = application_id and applications.user_id = (select auth.uid())
  )
);
create policy documents_update_own on public.documents
for update to authenticated using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy documents_delete_own on public.documents
for delete to authenticated using ((select auth.uid()) = user_id);

grant usage on type public.application_status, public.application_source,
  public.event_source, public.capture_status, public.application_event_type
  to authenticated;
grant select, insert, update, delete on public.applications to authenticated;
grant select, insert on public.application_events to authenticated;
grant select, insert, update, delete on public.documents to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('temporary-captures', 'temporary-captures', false, 26214400,
    array['application/octet-stream', 'multipart/related', 'message/rfc822']),
  ('job-descriptions', 'job-descriptions', false, 26214400,
    array['application/pdf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy temporary_captures_insert_own on storage.objects
for insert to authenticated with check (
  bucket_id = 'temporary-captures'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
create policy temporary_captures_select_own on storage.objects
for select to authenticated using (
  bucket_id = 'temporary-captures'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
create policy temporary_captures_delete_own on storage.objects
for delete to authenticated using (
  bucket_id = 'temporary-captures'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
create policy job_descriptions_select_own on storage.objects
for select to authenticated using (
  bucket_id = 'job-descriptions'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
create policy job_descriptions_delete_own on storage.objects
for delete to authenticated using (
  bucket_id = 'job-descriptions'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
