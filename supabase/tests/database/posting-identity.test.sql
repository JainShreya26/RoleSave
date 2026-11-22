-- Saving different jobs from URLs that look alike, and one job from URLs that
-- do not. A false duplicate loses the job: the save reuses another role and
-- nothing records the job that was actually on the page.

begin;

create extension if not exists pgtap with schema extensions;
select plan(24);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'a3000000-0000-4000-8000-00000000000a', 'authenticated', 'authenticated', 'identity-a@example.com', '', now(), '{}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-00000000000a', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

-- ---------------------------------------------------------------------------
-- Workday: jobs in one city have the location in common, not the requisition
-- ---------------------------------------------------------------------------

select is(
  (select application_reused from public.create_capture_session(
    'Acme', 'Software Engineer',
    'https://acme.wd5.myworkdayjobs.com/en-US/External/job/New-York-NY/Software-Engineer_R1234/apply',
    now(), gen_random_uuid())),
  false, 'the first Workday job makes a role'
);
select is(
  (select application_reused from public.create_capture_session(
    'Acme', 'Data Engineer',
    'https://acme.wd5.myworkdayjobs.com/en-US/External/job/New-York-NY/Data-Engineer_R5678/apply',
    now(), gen_random_uuid())),
  false, 'another Workday job in the same city makes its own role'
);
select is(
  (select count(*)::integer from public.applications where company = 'Acme'),
  2, 'both Workday jobs are tracked'
);
select is(
  (select ats_job_id from public.applications where position = 'Software Engineer'),
  'r1234', 'the role records the requisition, not the city'
);
select is(
  (select application_position from public.create_capture_session(
    'Acme', 'Retitled',
    'https://acme.wd5.myworkdayjobs.com/en-US/External/job/New-York-NY/Software-Engineer_R1234',
    now(), gen_random_uuid())),
  'Software Engineer', 'the job page finds the role saved from its apply page'
);
select is(
  (select application_position from public.create_capture_session(
    'Acme', 'Retitled',
    'https://acme.wd5.myworkdayjobs.com/en-US/External/job/New-York-NY/Data-Engineer_R5678/',
    now(), gen_random_uuid())),
  'Data Engineer', 'a trailing slash finds the same role'
);
select is(
  public.find_existing_application(
    'https://acme.wd5.myworkdayjobs.com/en-US/External/job/New-York-NY/Product-Manager_R9999/apply',
    'Acme'
  ),
  null::uuid, 'the manual form finds no match for a third job in that city'
);
select lives_ok(
  $$insert into public.applications (user_id, company, company_normalized, position, position_normalized, status, source, original_url)
    values (auth.uid(), 'Acme', '', 'Product Manager', '', 'SAVED', 'MANUAL',
      'https://acme.wd5.myworkdayjobs.com/en-US/External/job/New-York-NY/Product-Manager_R9999/apply')$$,
  'the manual form can create that third job'
);

-- ---------------------------------------------------------------------------
-- Greenhouse embedded forms
-- ---------------------------------------------------------------------------

select is(
  (select application_reused from public.create_capture_session(
    'Embed One', 'Role One',
    'https://boards.greenhouse.io/embed/job_app?for=embedone&token=1111111',
    now(), gen_random_uuid())),
  false, 'a Greenhouse embedded form makes a role'
);
select is(
  (select application_reused from public.create_capture_session(
    'Embed Two', 'Role Two',
    'https://boards.greenhouse.io/embed/job_app?for=embedtwo&token=2222222',
    now(), gen_random_uuid())),
  false, 'another employer on an embedded form makes its own role'
);
select is(
  (select application_position from public.create_capture_session(
    'Embed One', 'Retitled',
    'https://job-boards.greenhouse.io/embedone/jobs/1111111',
    now(), gen_random_uuid())),
  'Role One', 'the hosted page finds the role saved from its embedded form'
);

-- ---------------------------------------------------------------------------
-- SmartRecruiters one-click forms
-- ---------------------------------------------------------------------------

select is(
  (select application_reused from public.create_capture_session(
    'Click One', 'Role One',
    'https://jobs.smartrecruiters.com/oneclick-ui/company/ClickOne/publication/aaaaaaaa-1111-4111-8111-111111111111',
    now(), gen_random_uuid())),
  false, 'a one-click form makes a role'
);
select is(
  (select application_reused from public.create_capture_session(
    'Click Two', 'Role Two',
    'https://jobs.smartrecruiters.com/oneclick-ui/company/ClickTwo/publication/bbbbbbbb-2222-4222-8222-222222222222',
    now(), gen_random_uuid())),
  false, 'another employer on a one-click form makes its own role'
);

-- ---------------------------------------------------------------------------
-- BambooHR view pages
-- ---------------------------------------------------------------------------

select is(
  (select application_reused from public.create_capture_session(
    'Bamboo Co', 'Role One',
    'https://bamboo.bamboohr.com/jobs/view.php?id=11',
    now(), gen_random_uuid())),
  false, 'a BambooHR view page makes a role'
);
select is(
  (select application_reused from public.create_capture_session(
    'Bamboo Co', 'Role Two',
    'https://bamboo.bamboohr.com/jobs/view.php?id=22',
    now(), gen_random_uuid())),
  false, 'another BambooHR job makes its own role'
);
select is(
  (select application_position from public.create_capture_session(
    'Bamboo Co', 'Retitled',
    'https://bamboo.bamboohr.com/jobs/view.php?id=11&source=linkedin',
    now(), gen_random_uuid())),
  'Role One', 'the same BambooHR job finds its role'
);

-- ---------------------------------------------------------------------------
-- Editing a role recalculates the key from the same rules
-- ---------------------------------------------------------------------------

update public.applications
set original_url = 'https://acme.wd5.myworkdayjobs.com/External/job/Austin-TX/Analyst_R4444/apply'
where position = 'Product Manager';
select is(
  (select identity_key from public.applications where position = 'Product Manager'),
  'ats:workday:acme:r4444', 'an edited URL gets the new key'
);
select throws_ok(
  $$update public.applications
    set original_url = 'https://acme.wd5.myworkdayjobs.com/External/job/Remote/Analyst_R4444'
    where position = 'Data Engineer'$$,
  '23505', null, 'the unique index still refuses a true duplicate'
);
select is(
  (select count(*)::integer from public.applications where position in ('Software Engineer', 'Data Engineer', 'Product Manager')),
  3, 'no role was lost along the way'
);

-- URLs whose paths or query values differ by case can identify different jobs.
select is(
  (select application_reused from public.create_capture_session(
    'Case Test Co', 'First Case Role', 'https://jobs.example.test/open?id=AbC', now(), gen_random_uuid())),
  false, 'the first case-sensitive query value makes a role'
);
select is(
  (select application_reused from public.create_capture_session(
    'Case Test Co', 'Second Case Role', 'https://jobs.example.test/open?id=aBc', now(), gen_random_uuid())),
  false, 'a differently cased query value makes a separate role'
);
select is(
  public.find_existing_application('https://jobs.example.test/open?id=aBc', 'Case Test Co'),
  (select id from public.applications where position = 'Second Case Role'),
  'the manual form matches the role with the exact query value'
);
select is(
  public.find_existing_application('https://jobs.example.test/Open?id=AbC', 'Case Test Co'),
  null::uuid, 'a differently cased path has no match'
);
select is(
  public.find_existing_application('HTTPS://WWW.JOBS.EXAMPLE.TEST/open?id=AbC&UTM_SOURCE=extension', 'Case Test Co', 'REQ-123'),
  (select id from public.applications where position = 'First Case Role'),
  'the URL fallback still matches after normalizing the host and removing tracking parameters'
);

select * from finish();
rollback;
