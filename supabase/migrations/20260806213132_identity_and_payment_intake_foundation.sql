create schema if not exists private;

comment on schema private is
  'Server-only data and helper routines. This schema must never be exposed through the Data API.';

create type public.organization_role as enum ('owner', 'manager', 'tenant');
create type public.gmail_connection_status as enum (
  'connected',
  'needs_reauthorization',
  'sync_delayed',
  'disconnected'
);
create type public.gmail_sync_status as enum ('idle', 'running', 'delayed', 'failed');
create type public.payment_source_event_type as enum (
  'deposit_completed',
  'deposit_cancelled',
  'deposit_reversed',
  'unsupported'
);
create type public.payment_parse_outcome as enum ('parsed', 'unsupported', 'ignored');
create type public.reconciliation_outcome as enum (
  'pending_review',
  'matched',
  'rejected',
  'duplicate',
  'reversal_pending'
);

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 160),
  created_by uuid not null references auth.users (id),
  currency text not null default 'CAD' check (currency = 'CAD'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, created_by)
);

create table public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  user_id uuid not null references auth.users (id),
  role public.organization_role not null,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (id, organization_id)
);

create unique index organization_memberships_active_role_unique
  on public.organization_memberships (organization_id, user_id, role)
  where revoked_at is null;

create index organization_memberships_user_active_idx
  on public.organization_memberships (user_id, organization_id)
  where revoked_at is null;

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  display_name text not null check (char_length(display_name) between 1 and 160),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, organization_id)
);

create table public.units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  property_id uuid not null,
  label text not null check (char_length(label) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, organization_id),
  constraint units_property_organization_fk
    foreign key (property_id, organization_id)
    references public.properties (id, organization_id)
);

create table public.tenancies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  unit_id uuid not null,
  starts_on date not null,
  ends_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, organization_id),
  constraint tenancies_unit_organization_fk
    foreign key (unit_id, organization_id)
    references public.units (id, organization_id),
  constraint tenancies_valid_dates_check
    check (ends_on is null or ends_on >= starts_on)
);

create table public.tenancy_participants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  tenancy_id uuid not null,
  user_id uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  unique (id, organization_id),
  constraint tenancy_participants_tenancy_organization_fk
    foreign key (tenancy_id, organization_id)
    references public.tenancies (id, organization_id)
);

create unique index tenancy_participants_active_unique
  on public.tenancy_participants (tenancy_id, user_id)
  where ended_at is null;

create table public.gmail_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations (id),
  provider text not null default 'google' check (provider = 'google'),
  provider_account_id text not null,
  inbox_email text not null check (inbox_email = lower(inbox_email)),
  status public.gmail_connection_status not null default 'connected',
  connected_by uuid not null references auth.users (id),
  connected_at timestamptz not null default now(),
  disconnected_at timestamptz,
  needs_reauthorization_at timestamptz,
  last_successful_sync_at timestamptz,
  last_error_code text check (last_error_code is null or char_length(last_error_code) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, provider_account_id)
);

create table public.gmail_sync_states (
  connection_id uuid primary key,
  organization_id uuid not null references public.organizations (id),
  last_history_id text check (last_history_id is null or last_history_id ~ '^[0-9]+$'),
  watch_expiration timestamptz,
  status public.gmail_sync_status not null default 'idle',
  last_notification_at timestamptz,
  last_recovery_sync_at timestamptz,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  updated_at timestamptz not null default now(),
  constraint gmail_sync_states_connection_organization_fk
    foreign key (connection_id, organization_id)
    references public.gmail_connections (id, organization_id)
);

create table public.payment_source_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  connection_id uuid not null,
  provider_message_id text not null,
  provider_history_id text check (provider_history_id is null or provider_history_id ~ '^[0-9]+$'),
  event_type public.payment_source_event_type not null,
  parse_outcome public.payment_parse_outcome not null,
  parser_version text not null,
  payer_fingerprint text check (payer_fingerprint is null or payer_fingerprint ~ '^[a-f0-9]{64}$'),
  sender_display_name text,
  amount_minor bigint check (amount_minor is null or amount_minor >= 0),
  currency text check (currency is null or currency = 'CAD'),
  received_at timestamptz,
  provider_reference text,
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (connection_id, provider_message_id),
  constraint payment_source_events_connection_organization_fk
    foreign key (connection_id, organization_id)
    references public.gmail_connections (id, organization_id),
  constraint payment_source_events_parsed_fields_check
    check (
      parse_outcome <> 'parsed'
      or (
        payer_fingerprint is not null
        and amount_minor is not null
        and currency = 'CAD'
        and received_at is not null
      )
    )
);

create index payment_source_events_organization_created_idx
  on public.payment_source_events (organization_id, created_at desc);

create table public.payer_identities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  payer_fingerprint text not null check (payer_fingerprint ~ '^[a-f0-9]{64}$'),
  display_name text,
  first_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, payer_fingerprint)
);

create table public.payer_tenancy_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  payer_identity_id uuid not null,
  tenancy_id uuid not null,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  unique (id, organization_id),
  constraint payer_tenancy_mappings_payer_organization_fk
    foreign key (payer_identity_id, organization_id)
    references public.payer_identities (id, organization_id),
  constraint payer_tenancy_mappings_tenancy_organization_fk
    foreign key (tenancy_id, organization_id)
    references public.tenancies (id, organization_id)
);

create unique index payer_tenancy_mappings_active_unique
  on public.payer_tenancy_mappings (payer_identity_id, tenancy_id)
  where ended_at is null;

create table public.reconciliation_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  source_event_id uuid not null,
  tenancy_id uuid,
  outcome public.reconciliation_outcome not null,
  decided_by uuid references auth.users (id),
  reason_code text not null check (char_length(reason_code) between 1 and 80),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  constraint reconciliation_decisions_source_organization_fk
    foreign key (source_event_id, organization_id)
    references public.payment_source_events (id, organization_id),
  constraint reconciliation_decisions_tenancy_organization_fk
    foreign key (tenancy_id, organization_id)
    references public.tenancies (id, organization_id)
);

create index reconciliation_decisions_source_created_idx
  on public.reconciliation_decisions (source_event_id, created_at desc);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  actor_user_id uuid references auth.users (id),
  event_type text not null check (char_length(event_type) between 1 and 100),
  target_type text not null check (char_length(target_type) between 1 and 80),
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint audit_events_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

create index audit_events_organization_created_idx
  on public.audit_events (organization_id, created_at desc);

create table private.gmail_oauth_authorization_states (
  state_hash text primary key check (state_hash ~ '^[a-f0-9]{64}$'),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  verifier_ciphertext text not null,
  return_url text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index gmail_oauth_authorization_states_expiry_idx
  on private.gmail_oauth_authorization_states (expires_at);

create table private.gmail_oauth_tokens (
  connection_id uuid primary key references public.gmail_connections (id) on delete cascade,
  token_ciphertext text not null,
  access_token_expires_at timestamptz not null,
  granted_scopes text[] not null,
  updated_at timestamptz not null default now()
);

create table private.gmail_token_revocations (
  connection_id uuid primary key references public.gmail_connections (id) on delete cascade,
  refresh_token_ciphertext text not null,
  created_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  updated_at timestamptz not null default now()
);

create table private.gmail_notification_receipts (
  pubsub_message_id text primary key,
  connection_id uuid references public.gmail_connections (id) on delete set null,
  notified_history_id text not null check (notified_history_id ~ '^[0-9]+$'),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  outcome text check (outcome in ('processing', 'processed', 'failed')),
  error_code text check (error_code is null or char_length(error_code) <= 80)
);

comment on table public.payment_source_events is
  'Immutable Gmail-derived intake facts. A source event is never a ledger payment.';
comment on table private.gmail_oauth_tokens is
  'Application-encrypted OAuth token bundles. Accessible only through a direct server database connection.';
comment on table private.gmail_token_revocations is
  'Application-encrypted refresh tokens retained only while provider revocation needs a retry.';
comment on column public.audit_events.metadata is
  'Non-secret structured audit context. Tokens, message bodies, and provider credentials are prohibited.';
