#!/usr/bin/env bash
#
# Runs the fingerprint SQL tests against a disposable local PostgreSQL
# database. Nothing here touches the linked Supabase project.
#
#   pnpm test:fingerprint
#
# Requires a local PostgreSQL server (createdb/psql on PATH). The scratch
# database is created fresh and dropped on exit, including on failure.

set -euo pipefail

DB="${FINGERPRINT_TEST_DB:-rolesave_fingerprint_test}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS=(
  "$ROOT/supabase/migrations/20260825120000_application_fingerprint.sql"
  "$ROOT/supabase/migrations/20260825130000_email_match_candidates.sql"
  "$ROOT/supabase/migrations/20260825140000_ats_board_families.sql"
  "$ROOT/supabase/migrations/20260825144000_application_deduplication.sql"
)
TESTS=(
  "$ROOT/supabase/tests/database/fingerprint.test.sql"
  "$ROOT/supabase/tests/database/match-candidates.test.sql"
  "$ROOT/supabase/tests/database/application-deduplication.test.sql"
)

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

# The migration expects Supabase roles and the surrounding schema. This is the
# minimum scaffolding it needs; it is not a copy of the production schema.
psql -q -v ON_ERROR_STOP=1 -d "$DB" >/dev/null <<'BOOT'
-- Roles are cluster-wide rather than per-database, so a repeat run finds
-- them already present.
do $roles$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role;
  end if;
end $roles$;
-- Supabase installs extensions into their own schema; mirror that so the
-- migrations resolve similarity() the same way they will in production.
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
create schema if not exists auth;
create type public.capture_status as enum ('PENDING','PROCESSING','COMPLETE','FAILED');
create type public.event_source as enum ('EXTENSION','EMAIL','MANUAL','SYSTEM');
create type public.application_event_type as enum (
  'JD_SAVED','MARKED_AS_APPLIED','APPLICATION_CONFIRMED','ASSESSMENT_REQUESTED',
  'INTERVIEW_REQUESTED','INTERVIEW_SCHEDULED','INTERVIEW_RESCHEDULED',
  'OFFER_RECEIVED','REJECTION_RECEIVED','APPLICATION_WITHDRAWN','GENERAL_UPDATE',
  'MANUAL_CORRECTION','UNKNOWN_EMAIL_EVENT');
create table public.applications (
  id uuid primary key default gen_random_uuid(), user_id uuid not null,
  company text not null, company_normalized text not null, position text not null,
  position_normalized text not null, status text not null default 'SAVED',
  source text not null default 'EXTENSION', original_url text, original_domain text,
  job_id text, applied_at timestamptz, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());
create table public.documents (
  id uuid primary key, application_id uuid not null, user_id uuid not null,
  storage_path text not null unique, temporary_storage_path text, original_url text,
  capture_status public.capture_status not null, captured_at timestamptz,
  created_at timestamptz not null default now());
create table public.capture_jobs (
  id uuid primary key, user_id uuid not null, application_id uuid not null,
  document_id uuid not null, idempotency_key uuid not null, status public.capture_status not null,
  attempt_count integer not null default 0, available_at timestamptz, last_error text,
  completed_at timestamptz, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), unique(user_id, idempotency_key));
create type public.application_status as enum
  ('SAVED','APPLIED','ASSESSMENT','INTERVIEW','OFFER','REJECTED','WITHDRAWN','NEEDS_REVIEW');
alter table public.applications
  alter column status drop default,
  alter column status type public.application_status using status::public.application_status,
  alter column status set default 'SAVED';
create index applications_position_trgm_idx
  on public.applications using gin(position_normalized extensions.gin_trgm_ops);
create table public.application_events (
  id uuid primary key default gen_random_uuid(), application_id uuid not null,
  user_id uuid not null, event_type public.application_event_type not null,
  event_time timestamptz not null, source public.event_source not null,
  evidence text, previous_status public.application_status,
  new_status public.application_status, created_at timestamptz not null default now());
create table public.email_events (
  id uuid primary key default gen_random_uuid(), application_id uuid,
  user_id uuid not null);
create table public.review_tasks (
  id uuid primary key default gen_random_uuid(), user_id uuid not null,
  suggested_application_ids uuid[] not null default array[]::uuid[]);
create function public.normalize_application_fields() returns trigger
  language plpgsql as $$ begin return new; end; $$;
create trigger applications_normalize_before_write
  before insert or update of company, position, original_url
  on public.applications for each row execute function public.normalize_application_fields();
create function public.create_capture_session(text,text,text,timestamptz,uuid)
  returns void language sql as $$ select $$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
BOOT

for migration in "${MIGRATIONS[@]}"; do
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -c "set search_path = public, extensions;" -f "$migration" >/dev/null
done

# ON_ERROR_STOP makes psql exit non-zero when a check raises, and pipefail
# carries that through the filter so the script fails with it.
set -o pipefail
for suite in "${TESTS[@]}"; do
  psql -v ON_ERROR_STOP=1 -d "$DB" -f "$suite" 2>&1 | grep -vE '^(DO|SET|INSERT [0-9]+ [0-9]+)$'
done
echo "database: all checks passed"
