create type public.email_provider as enum ('FORWARDING', 'GMAIL', 'OUTLOOK');

create table public.email_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider public.email_provider not null,
  provider_account_id text not null,
  email_address text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, email_address),
  unique (user_id, provider, provider_account_id)
);

create unique index email_accounts_forwarding_user_idx
  on public.email_accounts(user_id)
  where provider = 'FORWARDING';

create trigger email_accounts_set_updated_at
before update on public.email_accounts
for each row execute function public.set_updated_at();

alter table public.email_accounts enable row level security;

create policy email_accounts_select_own on public.email_accounts
for select to authenticated using ((select auth.uid()) = user_id);

create policy email_accounts_delete_own on public.email_accounts
for delete to authenticated using ((select auth.uid()) = user_id);

grant usage on type public.email_provider to authenticated;
grant select, delete on public.email_accounts to authenticated;

create function public.issue_forwarding_address(p_domain text)
returns table (
  id uuid,
  provider public.email_provider,
  email_address text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_user_id uuid := auth.uid();
  v_domain text := lower(trim(p_domain));
  v_account public.email_accounts%rowtype;
  v_token text;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if v_domain !~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$' then
    raise exception 'A valid inbound email domain is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':forwarding', 0));

  select * into v_account
  from public.email_accounts
  where user_id = v_user_id and email_accounts.provider = 'FORWARDING';

  if v_account.id is null then
    loop
      v_token := encode(gen_random_bytes(18), 'hex');
      begin
        insert into public.email_accounts (
          user_id, provider, provider_account_id, email_address
        ) values (
          v_user_id,
          'FORWARDING',
          v_token,
          'jobs+' || v_token || '@' || v_domain
        )
        returning * into v_account;
        exit;
      exception when unique_violation then
        -- A token collision is extraordinarily unlikely; generate a new one.
      end;
    end loop;
  end if;

  return query select
    v_account.id,
    v_account.provider,
    v_account.email_address,
    v_account.created_at;
end;
$$;

revoke all on function public.issue_forwarding_address(text) from public;
grant execute on function public.issue_forwarding_address(text) to authenticated;
