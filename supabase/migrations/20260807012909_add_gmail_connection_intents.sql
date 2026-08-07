create table private.gmail_connection_intents (
  organization_id uuid primary key
    references public.organizations (id) on delete cascade,
  state_hash text not null unique
    check (state_hash ~ '^[a-f0-9]{64}$'),
  requested_by uuid not null
    references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index gmail_connection_intents_expiry_idx
  on private.gmail_connection_intents (expires_at);

create index gmail_connection_intents_requested_by_idx
  on private.gmail_connection_intents (requested_by);

alter table private.gmail_connection_intents enable row level security;
alter table private.gmail_connection_intents force row level security;

revoke all on private.gmail_connection_intents from public, anon, authenticated;

comment on table private.gmail_connection_intents is
  'Binds the latest owner-authorized Gmail connection attempt to an organization so disconnect can cancel in-flight OAuth callbacks.';
