create or replace function public.issue_forwarding_address(p_domain text)
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
  elsif lower(split_part(v_account.email_address, '@', 2)) <> v_domain then
    loop
      v_token := encode(gen_random_bytes(18), 'hex');
      begin
        update public.email_accounts
        set provider_account_id = v_token,
            email_address = 'jobs+' || v_token || '@' || v_domain
        where email_accounts.id = v_account.id
        returning * into v_account;
        exit;
      exception when unique_violation then
        -- Retry if the new opaque token happens to collide.
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
