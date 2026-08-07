-- Synthetic local-development data only. Do not replace with real tenant, Gmail, or payment data.
insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token
)
values (
  '00000000-0000-0000-0000-000000000000',
  'f0000000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'local-owner@example.test',
  '',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now(),
  '',
  '',
  '',
  ''
)
on conflict (id) do nothing;

insert into public.organizations (id, name, created_by)
values (
  'f1000000-0000-0000-0000-000000000001',
  'Synthetic Local Portfolio',
  'f0000000-0000-0000-0000-000000000001'
)
on conflict (id) do nothing;

insert into public.organization_memberships (
  id,
  organization_id,
  user_id,
  role,
  created_by
)
values (
  'f2000000-0000-0000-0000-000000000001',
  'f1000000-0000-0000-0000-000000000001',
  'f0000000-0000-0000-0000-000000000001',
  'owner',
  'f0000000-0000-0000-0000-000000000001'
)
on conflict (id) do nothing;
