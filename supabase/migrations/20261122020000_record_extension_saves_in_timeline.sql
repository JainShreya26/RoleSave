-- A role added by hand starts its timeline with "Application created
-- manually", but a role saved from the extension started with nothing, and
-- stayed empty if its PDF failed. Record the save when the role is created.

create function public.record_extension_save()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.application_events (
    application_id, user_id, event_type, event_time, source, evidence, new_status
  ) values (
    new.id, new.user_id, 'GENERAL_UPDATE', new.created_at, 'EXTENSION',
    'Saved from the browser extension', new.status
  );
  return null;
end;
$$;

revoke all on function public.record_extension_save() from public, anon, authenticated;

create trigger applications_record_extension_save
after insert on public.applications
for each row
when (new.source = 'EXTENSION')
execute function public.record_extension_save();

-- Roles saved before this change get the same first entry.
insert into public.application_events (
  application_id, user_id, event_type, event_time, source, evidence, new_status
)
select a.id, a.user_id, 'GENERAL_UPDATE', a.created_at, 'EXTENSION',
  'Saved from the browser extension', 'SAVED'
from public.applications a
where a.source = 'EXTENSION'
  and not exists (
    select 1 from public.application_events e
    where e.application_id = a.id and e.evidence = 'Saved from the browser extension'
  );
