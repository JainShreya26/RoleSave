#!/usr/bin/env bash
#
# Verifies the orphaned-object cleanup migration against a disposable local
# PostgreSQL database. Nothing here touches the linked Supabase project.
#
#   pnpm test:cleanup
#
# The scaffolding below reproduces only the objects the migration reads or
# removes, in their pre-migration shape, so the migration runs against the same
# starting state it will meet in the real database.

set -euo pipefail

DB="${CLEANUP_TEST_DB:-rolesave_cleanup_test}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATION="$ROOT/supabase/migrations/20260826010000_remove_orphaned_operational_objects.sql"
TEST="$ROOT/supabase/tests/database/orphaned-objects.test.sql"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql was not found. Install PostgreSQL or add it to PATH." >&2
  exit 1
fi
if ! pg_isready -q 2>/dev/null; then
  echo "No PostgreSQL server is accepting connections." >&2
  exit 1
fi

cleanup() { dropdb --if-exists "$DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT

cleanup
createdb "$DB"

psql -q -v ON_ERROR_STOP=1 -d "$DB" >/dev/null <<'BOOT'
do $roles$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $roles$;

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

create type public.capture_status as enum ('PENDING','PROCESSING','COMPLETE','FAILED');
create type public.email_job_status as enum ('PENDING','PROCESSING','COMPLETE','FAILED');
create type public.application_status as enum
  ('SAVED','APPLIED','ASSESSMENT','INTERVIEW','OFFER','REJECTED','WITHDRAWN','NEEDS_REVIEW');
create type public.application_source as enum ('EXTENSION','EMAIL','MANUAL');

create table public.applications (
  id uuid primary key default gen_random_uuid(), user_id uuid not null,
  company text not null, company_normalized text not null,
  position text not null, position_normalized text not null,
  status public.application_status not null default 'SAVED',
  source public.application_source not null default 'EXTENSION',
  original_url text, original_domain text, job_id text,
  applied_at timestamptz, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());

-- The index the migration drops.
create index applications_position_trgm_idx
  on public.applications using gin(position_normalized extensions.gin_trgm_ops);

create table public.documents (
  id uuid primary key, application_id uuid not null references public.applications(id) on delete cascade,
  user_id uuid not null, storage_path text not null unique, temporary_storage_path text,
  capture_status public.capture_status not null, created_at timestamptz not null default now());

create table public.capture_jobs (
  id uuid primary key, user_id uuid not null,
  application_id uuid not null references public.applications(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  idempotency_key uuid not null, status public.capture_status not null,
  attempt_count integer not null default 0, failed_at timestamptz,
  created_at timestamptz not null default now());

create table public.inbound_email_jobs (
  id uuid primary key default gen_random_uuid(), user_id uuid not null,
  status public.email_job_status not null default 'PENDING',
  failed_at timestamptz, storage_deleted_at timestamptz,
  created_at timestamptz not null default now());

create table public.email_events (
  id uuid primary key default gen_random_uuid(), user_id uuid not null,
  application_id uuid references public.applications(id) on delete set null,
  match_confidence numeric(4,3), review_status text not null default 'PENDING',
  created_at timestamptz not null default now());

create table public.review_tasks (
  id uuid primary key default gen_random_uuid(), user_id uuid not null,
  email_event_id uuid not null unique references public.email_events(id) on delete cascade,
  suggested_application_ids uuid[] not null default '{}'::uuid[],
  reason text not null, status text not null default 'OPEN',
  resolved_at timestamptz, created_at timestamptz not null default now());

-- The rate-limit objects the migration removes.
create table public.webhook_rate_limits (
  scope_key text primary key, window_start timestamptz not null default now(),
  request_count integer not null default 1);

create function public.consume_webhook_rate_limit(
  p_scope_key text, p_maximum_requests integer, p_window_milliseconds integer)
returns table (allowed boolean, retry_after_seconds integer)
language sql security definer set search_path = '' as $$ select true, 0 $$;

-- The trigger the migration removes, in its pre-migration form.
create function public.create_default_email_review_task() returns trigger
language plpgsql security definer set search_path = pg_catalog, extensions as $$
begin
  insert into public.review_tasks (user_id, email_event_id, reason)
  values (new.user_id, new.id, 'Application matching is pending.');
  return new;
end;
$$;
create trigger email_events_create_review_task
after insert on public.email_events
for each row execute function public.create_default_email_review_task();

-- The update-only predecessor the migration replaces.
create function public.set_email_review_suggestions(
  p_email_event_id uuid, p_suggested_application_ids uuid[], p_reason text, p_match_confidence numeric)
returns boolean language plpgsql security definer set search_path = pg_catalog, extensions as $$
begin
  update public.review_tasks set suggested_application_ids = p_suggested_application_ids
  where review_tasks.email_event_id = p_email_event_id and review_tasks.status = 'OPEN';
  return found;
end;
$$;

create function public.purge_expired_operational_data(
  p_failed_metadata_retention_days integer default 90,
  p_rate_limit_retention_days integer default 2)
returns table (capture_jobs_deleted bigint, email_jobs_deleted bigint, rate_limit_rows_deleted bigint)
language sql security definer set search_path = '' as $$ select 0::bigint, 0::bigint, 0::bigint $$;
BOOT

psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$MIGRATION" >/dev/null

# psql's exit status is the verdict. Filtering its chatter through a pipe would
# hide that behind grep's own status, so capture first and report after.
if ! output="$(psql -v ON_ERROR_STOP=1 -d "$DB" -f "$TEST" 2>&1)"; then
  printf '%s\n' "$output" >&2
  exit 1
fi
printf '%s\n' "$output" | grep -vE '^(DO|BEGIN|ROLLBACK|SET|INSERT [0-9]+ [0-9]+)$' || true
echo "cleanup migration: all checks passed"
