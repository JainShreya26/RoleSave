create type public.email_job_status as enum ('PENDING', 'PROCESSING', 'COMPLETE', 'FAILED');

create table public.inbound_email_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email_account_id uuid not null references public.email_accounts(id) on delete cascade,
  provider_message_id text not null check (char_length(provider_message_id) between 1 and 512),
  storage_path text not null unique,
  status public.email_job_status not null default 'PENDING',
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz,
  file_size_bytes bigint check (file_size_bytes is null or file_size_bytes >= 0),
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (email_account_id, provider_message_id)
);

create index inbound_email_jobs_ready_idx
  on public.inbound_email_jobs(status, available_at, created_at)
  where status = 'PENDING' and available_at is not null;

create trigger inbound_email_jobs_set_updated_at
before update on public.inbound_email_jobs
for each row execute function public.set_updated_at();

alter table public.inbound_email_jobs enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'inbound-emails',
  'inbound-emails',
  false,
  10485760,
  array['message/rfc822', 'application/octet-stream']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create function public.prepare_inbound_email_job(
  p_forwarding_token text,
  p_provider_message_id text
)
returns table (
  job_id uuid,
  storage_path text,
  already_queued boolean
)
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_account public.email_accounts%rowtype;
  v_job public.inbound_email_jobs%rowtype;
begin
  p_forwarding_token := lower(trim(p_forwarding_token));
  p_provider_message_id := trim(p_provider_message_id);

  if p_forwarding_token !~ '^[0-9a-f]{36}$' then
    raise exception 'Forwarding address not found';
  end if;
  if char_length(p_provider_message_id) not between 1 and 512 then
    raise exception 'Provider message ID must contain 1 to 512 characters';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_forwarding_token || ':' || p_provider_message_id, 0)
  );

  select * into v_account
  from public.email_accounts
  where provider = 'FORWARDING'
    and provider_account_id = p_forwarding_token;

  if v_account.id is null then
    raise exception 'Forwarding address not found';
  end if;

  select * into v_job
  from public.inbound_email_jobs
  where email_account_id = v_account.id
    and provider_message_id = p_provider_message_id;

  if v_job.id is not null and (
    v_job.available_at is not null or v_job.status in ('PROCESSING', 'COMPLETE')
  ) then
    return query select v_job.id, v_job.storage_path, true;
    return;
  end if;

  if v_job.id is null then
    v_job.id := gen_random_uuid();
    v_job.storage_path :=
      v_account.user_id::text || '/' || v_account.id::text || '/' || v_job.id::text || '.eml';

    insert into public.inbound_email_jobs (
      id, user_id, email_account_id, provider_message_id, storage_path
    ) values (
      v_job.id,
      v_account.user_id,
      v_account.id,
      p_provider_message_id,
      v_job.storage_path
    );
  else
    update public.inbound_email_jobs
    set status = 'PENDING', available_at = null, last_error = null
    where id = v_job.id;
  end if;

  return query select v_job.id, v_job.storage_path, false;
end;
$$;

create function public.finalize_inbound_email_upload(
  p_job_id uuid,
  p_file_size_bytes bigint
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_storage_path text;
begin
  if p_file_size_bytes is null or p_file_size_bytes < 1 or p_file_size_bytes > 10485760 then
    raise exception 'Raw email size is outside the accepted range';
  end if;

  select storage_path into v_storage_path
  from public.inbound_email_jobs
  where id = p_job_id and status = 'PENDING' and available_at is null;

  if v_storage_path is null then
    return false;
  end if;

  if not exists (
    select 1 from storage.objects
    where bucket_id = 'inbound-emails' and name = v_storage_path
  ) then
    raise exception 'Raw email upload was not found';
  end if;

  update public.inbound_email_jobs
  set available_at = now(), file_size_bytes = p_file_size_bytes, last_error = null
  where id = p_job_id and status = 'PENDING' and available_at is null;

  return found;
end;
$$;

create function public.fail_inbound_email_upload(p_job_id uuid, p_error text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
begin
  update public.inbound_email_jobs
  set status = 'FAILED', available_at = null,
      last_error = left(coalesce(p_error, 'Raw email upload failed'), 2000)
  where id = p_job_id and status = 'PENDING' and available_at is null;

  return found;
end;
$$;

revoke all on function public.prepare_inbound_email_job(text, text) from public;
revoke all on function public.finalize_inbound_email_upload(uuid, bigint) from public;
revoke all on function public.fail_inbound_email_upload(uuid, text) from public;
grant execute on function public.prepare_inbound_email_job(text, text) to service_role;
grant execute on function public.finalize_inbound_email_upload(uuid, bigint) to service_role;
grant execute on function public.fail_inbound_email_upload(uuid, text) to service_role;
