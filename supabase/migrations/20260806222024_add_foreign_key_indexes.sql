-- PostgreSQL does not create indexes for referencing foreign-key columns.
-- Cover every relationship used by authorization joins, cleanup, or cascades.

create index gmail_notification_receipts_connection_idx
  on private.gmail_notification_receipts (connection_id);
create index gmail_oauth_states_organization_idx
  on private.gmail_oauth_authorization_states (organization_id);
create index gmail_oauth_states_user_idx
  on private.gmail_oauth_authorization_states (user_id);

create index audit_events_actor_user_idx
  on public.audit_events (actor_user_id);
create index gmail_connections_connected_by_idx
  on public.gmail_connections (connected_by);
create index gmail_sync_states_connection_organization_idx
  on public.gmail_sync_states (connection_id, organization_id);
create index gmail_sync_states_organization_idx
  on public.gmail_sync_states (organization_id);
create index organization_memberships_created_by_idx
  on public.organization_memberships (created_by);
create index organizations_created_by_idx
  on public.organizations (created_by);
create index payer_tenancy_mappings_created_by_idx
  on public.payer_tenancy_mappings (created_by);
create index payer_tenancy_mappings_organization_idx
  on public.payer_tenancy_mappings (organization_id);
create index payer_tenancy_mappings_payer_organization_idx
  on public.payer_tenancy_mappings (payer_identity_id, organization_id);
create index payer_tenancy_mappings_tenancy_organization_idx
  on public.payer_tenancy_mappings (tenancy_id, organization_id);
create index payment_source_events_connection_organization_idx
  on public.payment_source_events (connection_id, organization_id);
create index properties_organization_idx
  on public.properties (organization_id);
create index reconciliation_decisions_decided_by_idx
  on public.reconciliation_decisions (decided_by);
create index reconciliation_decisions_organization_idx
  on public.reconciliation_decisions (organization_id);
create index reconciliation_decisions_source_organization_idx
  on public.reconciliation_decisions (source_event_id, organization_id);
create index reconciliation_decisions_tenancy_organization_idx
  on public.reconciliation_decisions (tenancy_id, organization_id);
create index tenancies_organization_idx
  on public.tenancies (organization_id);
create index tenancies_unit_organization_idx
  on public.tenancies (unit_id, organization_id);
create index tenancy_participants_organization_idx
  on public.tenancy_participants (organization_id);
create index tenancy_participants_tenancy_organization_idx
  on public.tenancy_participants (tenancy_id, organization_id);
create index tenancy_participants_user_idx
  on public.tenancy_participants (user_id);
create index units_organization_idx
  on public.units (organization_id);
create index units_property_organization_idx
  on public.units (property_id, organization_id);
