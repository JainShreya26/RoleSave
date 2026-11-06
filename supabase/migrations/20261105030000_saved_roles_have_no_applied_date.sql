-- A saved role has not been applied to, so it cannot have an applied date.
--
-- The dashboard already refuses this, but the rule belongs in the database too,
-- because signed-in users can write to this table directly. Any date removed here
-- is kept in the role's timeline.

insert into public.application_events (
  application_id, user_id, event_type, event_time, source, evidence,
  previous_status, new_status
)
select
  id, user_id, 'MANUAL_CORRECTION', now(), 'SYSTEM',
  'Applied date cleared because the role is saved (was '
    || to_char(applied_at at time zone 'UTC', 'Mon FMDD, YYYY, FMHH12:MI AM') || ' UTC)',
  status, status
from public.applications
where status = 'SAVED' and applied_at is not null;

update public.applications
set applied_at = null
where status = 'SAVED' and applied_at is not null;

alter table public.applications
  add constraint applications_saved_has_no_applied_date
  check (status <> 'SAVED' or applied_at is null);
