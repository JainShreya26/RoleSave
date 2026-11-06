alter table public.applications
  add column triage_decision text
    check (triage_decision in ('PURSUE', 'MAYBE', 'PASS')),
  add column triage_reason text
    check (triage_reason is null or char_length(triage_reason) <= 500);

create table public.application_actions (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 200),
  due_at timestamptz not null,
  remind_at timestamptz check (remind_at is null or remind_at <= due_at),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index application_actions_user_open_idx
  on public.application_actions(user_id, due_at)
  where completed_at is null;
create index application_actions_application_idx
  on public.application_actions(application_id, due_at);

create trigger application_actions_set_updated_at
before update on public.application_actions
for each row execute function public.set_updated_at();

alter table public.application_actions enable row level security;

create policy application_actions_select_own on public.application_actions
for select to authenticated using ((select auth.uid()) = user_id);
create policy application_actions_insert_own on public.application_actions
for insert to authenticated with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.applications
    where applications.id = application_id and applications.user_id = (select auth.uid())
  )
);
create policy application_actions_update_own on public.application_actions
for update to authenticated using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.applications
    where applications.id = application_id and applications.user_id = (select auth.uid())
  )
);
create policy application_actions_delete_own on public.application_actions
for delete to authenticated using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.application_actions to authenticated;

-- Optional, user-provided application materials. These are separate from the
-- browser-captured job description and never enter the PDF conversion queue.
create table public.application_attachments (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  file_name text not null check (char_length(file_name) between 1 and 255),
  mime_type text not null check (mime_type in (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )),
  file_size_bytes bigint not null check (file_size_bytes between 1 and 6291456),
  storage_path text not null unique,
  created_at timestamptz not null default now(),
  check (storage_path like (user_id::text || '/%'))
);

create index application_attachments_application_idx
  on public.application_attachments(application_id, created_at desc);

alter table public.application_attachments enable row level security;
create policy application_attachments_select_own on public.application_attachments
for select to authenticated using ((select auth.uid()) = user_id);
create policy application_attachments_insert_own on public.application_attachments
for insert to authenticated with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.applications
    where applications.id = application_id and applications.user_id = (select auth.uid())
  )
);
create policy application_attachments_delete_own on public.application_attachments
for delete to authenticated using ((select auth.uid()) = user_id);
grant select, insert, delete on public.application_attachments to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('application-attachments', 'application-attachments', false, 6291456,
  array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy application_attachments_storage_insert_own on storage.objects
for insert to authenticated with check (
  bucket_id = 'application-attachments'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
create policy application_attachments_storage_select_own on storage.objects
for select to authenticated using (
  bucket_id = 'application-attachments'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
create policy application_attachments_storage_delete_own on storage.objects
for delete to authenticated using (
  bucket_id = 'application-attachments'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- Preserve actions and the saved-role decision when exact duplicates are merged.
create or replace function public._merge_application_records(
  p_keep_application_id uuid,
  p_merge_application_id uuid,
  p_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_keep public.applications%rowtype;
  v_merge public.applications%rowtype;
begin
  if p_keep_application_id = p_merge_application_id then
    return p_keep_application_id;
  end if;

  perform 1
  from public.applications
  where id in (p_keep_application_id, p_merge_application_id)
  order by id
  for update;

  select * into v_keep from public.applications
  where id = p_keep_application_id and user_id = p_user_id;
  select * into v_merge from public.applications
  where id = p_merge_application_id and user_id = p_user_id;

  if v_keep.id is null or v_merge.id is null then
    raise exception 'Both applications must exist and belong to the same user';
  end if;

  update public.applications
  set status = case
        when public.application_status_rank(v_merge.status) > public.application_status_rank(v_keep.status)
          then v_merge.status
        else v_keep.status
      end,
      applied_at = case
        when v_keep.applied_at is null then v_merge.applied_at
        when v_merge.applied_at is null then v_keep.applied_at
        else least(v_keep.applied_at, v_merge.applied_at)
      end,
      original_url = coalesce(v_keep.original_url, v_merge.original_url),
      job_id = coalesce(v_keep.job_id, v_merge.job_id),
      triage_decision = coalesce(v_keep.triage_decision, v_merge.triage_decision),
      triage_reason = coalesce(v_keep.triage_reason, v_merge.triage_reason)
  where id = v_keep.id;

  update public.capture_jobs set application_id = v_keep.id
  where application_id = v_merge.id;
  update public.documents set application_id = v_keep.id
  where application_id = v_merge.id;
  update public.application_events set application_id = v_keep.id
  where application_id = v_merge.id;
  update public.application_actions set application_id = v_keep.id
  where application_id = v_merge.id;
  update public.application_attachments set application_id = v_keep.id
  where application_id = v_merge.id;

  delete from public.applications where id = v_merge.id;

  insert into public.application_events (
    application_id, user_id, event_type, event_time, source, evidence,
    previous_status, new_status
  )
  select
    v_keep.id, p_user_id, 'MANUAL_CORRECTION', now(), 'SYSTEM',
    'Exact duplicate application consolidated; linked documents, attachments, actions, and timeline history were preserved.',
    applications.status, applications.status
  from public.applications
  where id = v_keep.id;

  return v_keep.id;
end;
$$;

revoke all on function public._merge_application_records(uuid, uuid, uuid) from public;
