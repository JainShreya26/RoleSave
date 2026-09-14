begin;

create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '51000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'email-status@example.test', '', now(),
  '{}', '{}', now(), now()
);

insert into public.applications (
  id, user_id, company, company_normalized, position, position_normalized,
  status, source
) values (
  '52000000-0000-4000-8000-000000000002',
  '51000000-0000-4000-8000-000000000001',
  'Confirmation Co', '', 'Analyst', '', 'SAVED', 'EXTENSION'
);

insert into public.email_accounts (
  id, user_id, provider, provider_account_id, email_address
) values (
  '53000000-0000-4000-8000-000000000003',
  '51000000-0000-4000-8000-000000000001',
  'FORWARDING', 'email-status-token', 'jobs+email-status@example.test'
);

insert into public.inbound_email_jobs (
  id, user_id, email_account_id, provider_message_id, storage_path, status,
  attempt_count
) values (
  '54000000-0000-4000-8000-000000000004',
  '51000000-0000-4000-8000-000000000001',
  '53000000-0000-4000-8000-000000000003',
  'email-status-message', 'email-status/message.eml', 'COMPLETE', 1
);

insert into public.email_events (
  id, email_job_id, user_id, email_account_id, provider_message_id, subject,
  received_at, classification, classification_confidence, metadata_score,
  evidence
) values (
  '55000000-0000-4000-8000-000000000005',
  '54000000-0000-4000-8000-000000000004',
  '51000000-0000-4000-8000-000000000001',
  '53000000-0000-4000-8000-000000000003',
  'email-status-message', 'Thank you for applying', now(),
  'APPLICATION_CONFIRMED', 0.95, 50, 'Thank you for applying'
);

select ok(
  public.set_email_review_suggestions(
    '55000000-0000-4000-8000-000000000005',
    array['52000000-0000-4000-8000-000000000002'::uuid],
    'Confirm the application match',
    0.95
  ),
  'review task opens for the confirmation email'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '51000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select ok(
  public.resolve_email_review_task(
    (select id from public.review_tasks where email_event_id = '55000000-0000-4000-8000-000000000005'),
    '52000000-0000-4000-8000-000000000002'
  ),
  'confirmation email can be attached'
);
select is(
  (select status from public.applications where id = '52000000-0000-4000-8000-000000000002'),
  'SAVED'::public.application_status,
  'confirmation email does not mark the application applied'
);
select is(
  (select applied_at from public.applications where id = '52000000-0000-4000-8000-000000000002'),
  null::timestamptz,
  'confirmation email does not infer applied_at'
);
select is(
  (
    select previous_status::text || '->' || new_status::text
    from public.application_events
    where application_id = '52000000-0000-4000-8000-000000000002'
      and event_type = 'APPLICATION_CONFIRMED'
  ),
  'SAVED->SAVED',
  'confirmation remains visible as a no-status-change timeline event'
);

select * from finish();
rollback;
