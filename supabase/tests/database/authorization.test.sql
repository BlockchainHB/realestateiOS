begin;

create extension if not exists pgtap with schema extensions;
select plan(50);

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
select
  '00000000-0000-0000-0000-000000000000',
  user_id,
  'authenticated',
  'authenticated',
  email,
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
from (
  values
    ('10000000-0000-0000-0000-000000000001'::uuid, 'owner-one@example.test'),
    ('10000000-0000-0000-0000-000000000002'::uuid, 'manager@example.test'),
    ('10000000-0000-0000-0000-000000000003'::uuid, 'tenant@example.test'),
    ('10000000-0000-0000-0000-000000000004'::uuid, 'outsider@example.test'),
    ('10000000-0000-0000-0000-000000000005'::uuid, 'owner-two@example.test'),
    ('10000000-0000-0000-0000-000000000006'::uuid, 'former-tenant@example.test')
) as fixture_users (user_id, email);

insert into public.organizations (id, name, created_by)
values
  ('20000000-0000-0000-0000-000000000001', 'Synthetic Organization One', '10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000002', 'Synthetic Organization Two', '10000000-0000-0000-0000-000000000005');

insert into public.organization_memberships (
  id,
  organization_id,
  user_id,
  role,
  created_by
)
values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'owner', '10000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'manager', '10000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 'tenant', '10000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000005', 'owner', '10000000-0000-0000-0000-000000000005'),
  ('30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000006', 'tenant', '10000000-0000-0000-0000-000000000001');

insert into public.properties (id, organization_id, display_name)
values ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Synthetic Property');
insert into public.units (id, organization_id, property_id, label)
values ('50000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'Unit Test');
insert into public.tenancies (id, organization_id, unit_id, starts_on)
values ('60000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', '2026-01-01');
insert into public.tenancy_participants (id, organization_id, tenancy_id, user_id, ended_at)
values
  ('70000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', null),
  ('70000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000006', now() - interval '1 day');

insert into public.gmail_connections (
  id,
  organization_id,
  provider_account_id,
  inbox_email,
  connected_by
)
values
  ('80000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'owner-one@example.test', 'owner-one@example.test', '10000000-0000-0000-0000-000000000001'),
  ('80000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'owner-two@example.test', 'owner-two@example.test', '10000000-0000-0000-0000-000000000005');
insert into public.gmail_sync_states (connection_id, organization_id, last_history_id)
values
  ('80000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '101'),
  ('80000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '202');

insert into public.payment_source_events (
  id,
  organization_id,
  connection_id,
  provider_message_id,
  provider_history_id,
  event_type,
  parse_outcome,
  parser_version,
  payer_fingerprint,
  sender_display_name,
  amount_minor,
  currency,
  received_at,
  provider_reference,
  content_sha256
)
values (
  '90000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '80000000-0000-0000-0000-000000000001',
  'synthetic-message-1',
  '102',
  'deposit_completed',
  'parsed',
  'synthetic-interac-v1',
  repeat('a', 64),
  'Synthetic Payer',
  100000,
  'CAD',
  now(),
  'SYNTHETIC-REFERENCE',
  repeat('b', 64)
);
insert into public.payer_identities (id, organization_id, payer_fingerprint, display_name)
values
  ('a0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', repeat('a', 64), 'Synthetic Payer'),
  ('a0000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', repeat('c', 64), 'Synthetic Alternate Payer');
insert into public.reconciliation_decisions (
  id,
  organization_id,
  source_event_id,
  outcome,
  decided_by,
  reason_code
)
values ('b0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', 'pending_review', null, 'first_sender_review_required');
insert into public.audit_events (id, organization_id, event_type, target_type)
values ('c0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'synthetic.audit', 'fixture');
insert into private.gmail_oauth_tokens (
  connection_id,
  token_ciphertext,
  access_token_expires_at,
  granted_scopes
)
values (
  '80000000-0000-0000-0000-000000000001',
  'synthetic-encrypted-placeholder',
  now() + interval '1 hour',
  array['https://www.googleapis.com/auth/gmail.readonly']
);

select is((
  select count(*)
  from public.profiles
  where user_id in (
    '10000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000004',
    '10000000-0000-0000-0000-000000000005',
    '10000000-0000-0000-0000-000000000006'
  )
), 6::bigint, 'auth trigger creates one profile per fixture auth user');
select is((select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relrowsecurity), 14::bigint, 'every public table has RLS enabled');
select is((select count(*) from pg_class where relnamespace = 'private'::regnamespace and relkind = 'r' and relrowsecurity and relforcerowsecurity), 4::bigint, 'private tables force RLS');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select results_eq('select count(*) from public.organizations', array[1::bigint], 'owner sees their organization');
select results_eq('select count(*) from public.gmail_connections', array[1::bigint], 'owner sees their Gmail connection');
select results_eq($$select count(*) from public.gmail_connections where organization_id = '20000000-0000-0000-0000-000000000002'$$, array[0::bigint], 'owner cannot see another organization Gmail connection');
select results_eq('select count(*) from public.payment_source_events', array[1::bigint], 'owner sees source events');
select results_eq('select count(*) from public.payer_identities', array[2::bigint], 'owner sees payer identities');
select results_eq('select count(*) from public.audit_events', array[1::bigint], 'owner sees audit events');
select results_eq('select count(*) from public.gmail_sync_states', array[1::bigint], 'owner sees Gmail sync health');

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select results_eq('select count(*) from public.organizations', array[1::bigint], 'manager sees their organization');
select results_eq('select count(*) from public.gmail_connections', array[0::bigint], 'manager cannot see Gmail connections');
select results_eq('select count(*) from public.gmail_sync_states', array[0::bigint], 'manager cannot see Gmail sync state');
select results_eq('select count(*) from public.payment_source_events', array[0::bigint], 'manager cannot see source events');
select results_eq('select count(*) from public.payer_identities', array[0::bigint], 'manager cannot see payer identities');
select results_eq('select count(*) from public.reconciliation_decisions', array[0::bigint], 'manager cannot see reconciliation decisions');
select results_eq('select count(*) from public.audit_events', array[0::bigint], 'manager cannot see sensitive audit events');
select throws_like($$update public.organizations set created_by = '10000000-0000-0000-0000-000000000002' where id = '20000000-0000-0000-0000-000000000001'$$, '%permission denied%', 'manager cannot reassign organization creator');
select throws_like($$insert into public.gmail_connections (organization_id, provider_account_id, inbox_email, connected_by) values ('20000000-0000-0000-0000-000000000001', 'attacker@example.test', 'attacker@example.test', '10000000-0000-0000-0000-000000000002')$$, '%permission denied%', 'manager cannot insert a Gmail connection');

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
select results_eq('select count(*) from public.organizations', array[1::bigint], 'tenant sees their organization context');
select results_eq('select count(*) from public.tenancies', array[1::bigint], 'active tenant sees their tenancy');
reset role;
update public.tenancies
set starts_on = current_date - 1,
    ends_on = current_date + 1
where id = '60000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
select results_eq('select count(*) from public.tenancies', array[1::bigint], 'tenant sees a bounded tenancy during its effective dates');
reset role;
update public.tenancies
set starts_on = current_date + 1,
    ends_on = current_date + 2
where id = '60000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
select results_eq('select count(*) from public.tenancies', array[0::bigint], 'tenant cannot see a tenancy before its effective start');
reset role;
update public.tenancies
set starts_on = current_date - 2,
    ends_on = current_date - 1
where id = '60000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
select results_eq('select count(*) from public.tenancies', array[0::bigint], 'tenant cannot see a tenancy after its effective end');
select results_eq('select count(*) from public.gmail_connections', array[0::bigint], 'tenant cannot see Gmail connections');
select results_eq('select count(*) from public.payment_source_events', array[0::bigint], 'tenant cannot see source events');

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000006', true);
select results_eq('select count(*) from public.tenancies', array[0::bigint], 'former tenant cannot see ended tenancy');

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
select results_eq('select count(*) from public.organizations', array[0::bigint], 'unrelated user cannot see organizations');

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000005', true);
select results_eq($$select count(*) from public.gmail_connections where organization_id = '20000000-0000-0000-0000-000000000002'$$, array[1::bigint], 'second organization owner sees own Gmail connection');
select results_eq($$select count(*) from public.gmail_connections where organization_id = '20000000-0000-0000-0000-000000000001'$$, array[0::bigint], 'second organization owner cannot cross organization boundary');

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select throws_like($$update public.organizations set created_by = '10000000-0000-0000-0000-000000000002' where id = '20000000-0000-0000-0000-000000000001'$$, '%permission denied%', 'owner cannot reassign organization creator through the Data API role');
select throws_like($$update public.organization_memberships set revoked_at = now() where id = '30000000-0000-0000-0000-000000000001'$$, '%retain at least one active owner%', 'last owner cannot be revoked');
select lives_ok($$insert into public.payer_tenancy_mappings (organization_id, payer_identity_id, tenancy_id, created_by) values ('20000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001')$$, 'owner can establish a payer mapping');

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select throws_like($$insert into public.payer_tenancy_mappings (organization_id, payer_identity_id, tenancy_id, created_by) values ('20000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002')$$, '%row-level security%', 'manager cannot establish a payer mapping');
select throws_like('select count(*) from private.gmail_oauth_tokens', '%permission denied%', 'manager cannot read private OAuth tokens');

reset role;
select throws_like($$update public.gmail_connections set provider_account_id = 'replacement@example.test', inbox_email = 'replacement@example.test' where id = '80000000-0000-0000-0000-000000000001'$$, '%Gmail connection identity is immutable%', 'retained Gmail connection identity cannot be replaced');
select throws_like($$insert into public.payment_source_events (organization_id, connection_id, provider_message_id, event_type, parse_outcome, parser_version, content_sha256) values ('20000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001', 'synthetic-message-1', 'deposit_completed', 'unsupported', 'synthetic-interac-v1', repeat('d', 64))$$, '%duplicate key%', 'duplicate provider message identity is rejected');
select throws_like($$update public.payment_source_events set parser_version = 'changed' where id = '90000000-0000-0000-0000-000000000001'$$, '%append-only%', 'source events are immutable');
select throws_like($$delete from public.payment_source_events where id = '90000000-0000-0000-0000-000000000001'$$, '%append-only%', 'source events cannot be deleted');
select throws_like($$update public.reconciliation_decisions set reason_code = 'changed' where id = 'b0000000-0000-0000-0000-000000000001'$$, '%append-only%', 'reconciliation decisions are immutable');
select throws_like($$delete from public.audit_events where id = 'c0000000-0000-0000-0000-000000000001'$$, '%append-only%', 'audit events cannot be deleted');
select is(has_table_privilege('anon', 'public.gmail_connections', 'select'), false, 'anonymous role has no Gmail table access');
select is(has_table_privilege('authenticated', 'public.gmail_connections', 'insert'), false, 'authenticated role cannot insert Gmail connections');
select is((select count(*) from pg_proc procedure join pg_namespace namespace on namespace.oid = procedure.pronamespace where namespace.nspname = 'public' and procedure.prosecdef), 0::bigint, 'no public SECURITY DEFINER functions exist');
select is(has_function_privilege('public', 'private.is_organization_owner(uuid)', 'execute'), false, 'PUBLIC cannot execute private owner helper');
select is(has_table_privilege('authenticated', 'private.gmail_oauth_tokens', 'select'), false, 'authenticated role has no token-table privilege');
select is(has_table_privilege('authenticated', 'private.gmail_token_revocations', 'select'), false, 'authenticated role has no provider-cleanup credential access');
select lives_ok($$insert into private.gmail_notification_receipts (pubsub_message_id, notified_history_id, outcome) values ('synthetic-pubsub-duplicate', '303', 'processing') on conflict (pubsub_message_id) do nothing; insert into private.gmail_notification_receipts (pubsub_message_id, notified_history_id, outcome) values ('synthetic-pubsub-duplicate', '303', 'processing') on conflict (pubsub_message_id) do nothing$$, 'duplicate Pub/Sub delivery is harmless');
insert into private.gmail_notification_receipts (pubsub_message_id, notified_history_id, received_at, outcome)
values ('synthetic-pubsub-stale', '404', now() - interval '6 minutes', 'processing');
select results_eq(
  $$insert into private.gmail_notification_receipts (pubsub_message_id, notified_history_id, outcome) values ('synthetic-pubsub-stale', '405', 'processing') on conflict (pubsub_message_id) do update set notified_history_id = excluded.notified_history_id, received_at = now(), processed_at = null, outcome = 'processing', error_code = null where private.gmail_notification_receipts.outcome = 'failed' or (private.gmail_notification_receipts.outcome = 'processing' and private.gmail_notification_receipts.received_at <= now() - interval '5 minutes') returning pubsub_message_id$$,
  array['synthetic-pubsub-stale'::text],
  'an abandoned Pub/Sub processing receipt is reclaimable after its lease'
);
select is(
  (select notified_history_id from private.gmail_notification_receipts where pubsub_message_id = 'synthetic-pubsub-stale'),
  '405',
  'reclaiming an abandoned Pub/Sub receipt keeps the newest history cursor'
);

select * from finish();
rollback;
