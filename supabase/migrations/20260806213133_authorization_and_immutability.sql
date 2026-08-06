create function private.is_organization_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.organization_memberships membership
      where membership.organization_id = target_organization_id
        and membership.user_id = (select auth.uid())
        and membership.revoked_at is null
    );
$$;

create function private.is_organization_owner(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.organization_memberships membership
      where membership.organization_id = target_organization_id
        and membership.user_id = (select auth.uid())
        and membership.role = 'owner'
        and membership.revoked_at is null
    );
$$;

create function private.can_bootstrap_organization_owner(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.organizations organization
      where organization.id = target_organization_id
        and organization.created_by = (select auth.uid())
    )
    and not exists (
      select 1
      from public.organization_memberships membership
      where membership.organization_id = target_organization_id
        and membership.role = 'owner'
        and membership.revoked_at is null
    );
$$;

create function private.is_active_tenancy_participant(
  target_organization_id uuid,
  target_tenancy_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.tenancy_participants participant
      join public.tenancies tenancy
        on tenancy.id = participant.tenancy_id
       and tenancy.organization_id = participant.organization_id
      where participant.organization_id = target_organization_id
        and participant.tenancy_id = target_tenancy_id
        and participant.user_id = (select auth.uid())
        and participant.ended_at is null
        and tenancy.ends_on is null
        and tenancy.archived_at is null
    );
$$;

create function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.id is null then
    raise exception 'auth user id is required';
  end if;

  insert into public.profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create function private.prevent_organization_reassignment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'organization_id is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

create function private.prevent_organization_creator_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.created_by is distinct from old.created_by then
    raise exception 'organization ownership cannot be reassigned by update' using errcode = '23514';
  end if;
  return new;
end;
$$;

create function private.prevent_membership_identity_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id
     or new.user_id is distinct from old.user_id
     or new.role is distinct from old.role
     or new.created_by is distinct from old.created_by then
    raise exception 'membership identity is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

create function private.prevent_last_owner_removal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_other_owners integer;
begin
  if old.role <> 'owner' or old.revoked_at is not null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'UPDATE' and new.revoked_at is null then
    return new;
  end if;

  select count(*)
  into active_other_owners
  from public.organization_memberships membership
  where membership.organization_id = old.organization_id
    and membership.role = 'owner'
    and membership.revoked_at is null
    and membership.id <> old.id;

  if active_other_owners = 0 then
    raise exception 'an organization must retain at least one active owner' using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create function private.reject_immutable_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '55000';
end;
$$;

revoke all on function private.is_organization_member(uuid) from public;
revoke all on function private.is_organization_owner(uuid) from public;
revoke all on function private.can_bootstrap_organization_owner(uuid) from public;
revoke all on function private.is_active_tenancy_participant(uuid, uuid) from public;
revoke all on function private.handle_new_auth_user() from public;
revoke all on function private.set_updated_at() from public;
revoke all on function private.prevent_organization_reassignment() from public;
revoke all on function private.prevent_organization_creator_change() from public;
revoke all on function private.prevent_membership_identity_change() from public;
revoke all on function private.prevent_last_owner_removal() from public;
revoke all on function private.reject_immutable_mutation() from public;

grant usage on schema private to authenticated;
grant execute on function private.is_organization_member(uuid) to authenticated;
grant execute on function private.is_organization_owner(uuid) to authenticated;
grant execute on function private.can_bootstrap_organization_owner(uuid) to authenticated;
grant execute on function private.is_active_tenancy_participant(uuid, uuid) to authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_auth_user();

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function private.set_updated_at();
create trigger properties_set_updated_at
  before update on public.properties
  for each row execute function private.set_updated_at();
create trigger units_set_updated_at
  before update on public.units
  for each row execute function private.set_updated_at();
create trigger tenancies_set_updated_at
  before update on public.tenancies
  for each row execute function private.set_updated_at();
create trigger gmail_connections_set_updated_at
  before update on public.gmail_connections
  for each row execute function private.set_updated_at();
create trigger gmail_sync_states_set_updated_at
  before update on public.gmail_sync_states
  for each row execute function private.set_updated_at();
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

create trigger organizations_prevent_creator_change
  before update on public.organizations
  for each row execute function private.prevent_organization_creator_change();
create trigger memberships_prevent_identity_change
  before update on public.organization_memberships
  for each row execute function private.prevent_membership_identity_change();
create trigger memberships_prevent_last_owner_removal
  before update or delete on public.organization_memberships
  for each row execute function private.prevent_last_owner_removal();

create trigger properties_prevent_organization_change
  before update on public.properties
  for each row execute function private.prevent_organization_reassignment();
create trigger units_prevent_organization_change
  before update on public.units
  for each row execute function private.prevent_organization_reassignment();
create trigger tenancies_prevent_organization_change
  before update on public.tenancies
  for each row execute function private.prevent_organization_reassignment();
create trigger participants_prevent_organization_change
  before update on public.tenancy_participants
  for each row execute function private.prevent_organization_reassignment();
create trigger payer_mappings_prevent_organization_change
  before update on public.payer_tenancy_mappings
  for each row execute function private.prevent_organization_reassignment();

create trigger payment_source_events_are_immutable
  before update or delete on public.payment_source_events
  for each row execute function private.reject_immutable_mutation();
create trigger reconciliation_decisions_are_immutable
  before update or delete on public.reconciliation_decisions
  for each row execute function private.reject_immutable_mutation();
create trigger audit_events_are_immutable
  before update or delete on public.audit_events
  for each row execute function private.reject_immutable_mutation();

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.properties enable row level security;
alter table public.units enable row level security;
alter table public.tenancies enable row level security;
alter table public.tenancy_participants enable row level security;
alter table public.gmail_connections enable row level security;
alter table public.gmail_sync_states enable row level security;
alter table public.payment_source_events enable row level security;
alter table public.payer_identities enable row level security;
alter table public.payer_tenancy_mappings enable row level security;
alter table public.reconciliation_decisions enable row level security;
alter table public.audit_events enable row level security;

alter table private.gmail_oauth_authorization_states enable row level security;
alter table private.gmail_oauth_authorization_states force row level security;
alter table private.gmail_oauth_tokens enable row level security;
alter table private.gmail_oauth_tokens force row level security;
alter table private.gmail_notification_receipts enable row level security;
alter table private.gmail_notification_receipts force row level security;

create policy profiles_select_self
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy profiles_update_self
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy organizations_select_members
  on public.organizations for select
  to authenticated
  using ((select private.is_organization_member(id)));

create policy organizations_insert_creator
  on public.organizations for insert
  to authenticated
  with check ((select auth.uid()) = created_by);

create policy organizations_update_owners
  on public.organizations for update
  to authenticated
  using ((select private.is_organization_owner(id)))
  with check ((select private.is_organization_owner(id)));

create policy memberships_select_self_or_owner
  on public.organization_memberships for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.is_organization_owner(organization_id))
  );

create policy memberships_insert_owner_controlled
  on public.organization_memberships for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and (
      (select private.is_organization_owner(organization_id))
      or (
        role = 'owner'
        and user_id = (select auth.uid())
        and (select private.can_bootstrap_organization_owner(organization_id))
      )
    )
  );

create policy memberships_update_owners
  on public.organization_memberships for update
  to authenticated
  using ((select private.is_organization_owner(organization_id)))
  with check ((select private.is_organization_owner(organization_id)));

create policy properties_select_owners
  on public.properties for select
  to authenticated
  using ((select private.is_organization_owner(organization_id)));
create policy properties_insert_owners
  on public.properties for insert
  to authenticated
  with check ((select private.is_organization_owner(organization_id)));
create policy properties_update_owners
  on public.properties for update
  to authenticated
  using ((select private.is_organization_owner(organization_id)))
  with check ((select private.is_organization_owner(organization_id)));

create policy units_select_owners
  on public.units for select
  to authenticated
  using ((select private.is_organization_owner(organization_id)));
create policy units_insert_owners
  on public.units for insert
  to authenticated
  with check ((select private.is_organization_owner(organization_id)));
create policy units_update_owners
  on public.units for update
  to authenticated
  using ((select private.is_organization_owner(organization_id)))
  with check ((select private.is_organization_owner(organization_id)));

create policy tenancies_select_owner_or_participant
  on public.tenancies for select
  to authenticated
  using (
    (select private.is_organization_owner(organization_id))
    or (select private.is_active_tenancy_participant(organization_id, id))
  );
create policy tenancies_insert_owners
  on public.tenancies for insert
  to authenticated
  with check ((select private.is_organization_owner(organization_id)));
create policy tenancies_update_owners
  on public.tenancies for update
  to authenticated
  using ((select private.is_organization_owner(organization_id)))
  with check ((select private.is_organization_owner(organization_id)));

create policy participants_select_self_or_owner
  on public.tenancy_participants for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.is_organization_owner(organization_id))
  );
create policy participants_insert_owners
  on public.tenancy_participants for insert
  to authenticated
  with check ((select private.is_organization_owner(organization_id)));
create policy participants_update_owners
  on public.tenancy_participants for update
  to authenticated
  using ((select private.is_organization_owner(organization_id)))
  with check ((select private.is_organization_owner(organization_id)));

create policy gmail_connections_select_owners
  on public.gmail_connections for select
  to authenticated
  using ((select private.is_organization_owner(organization_id)));
create policy gmail_sync_states_select_owners
  on public.gmail_sync_states for select
  to authenticated
  using ((select private.is_organization_owner(organization_id)));
create policy payment_source_events_select_owners
  on public.payment_source_events for select
  to authenticated
  using ((select private.is_organization_owner(organization_id)));
create policy payer_identities_select_owners
  on public.payer_identities for select
  to authenticated
  using ((select private.is_organization_owner(organization_id)));

create policy payer_mappings_select_owners
  on public.payer_tenancy_mappings for select
  to authenticated
  using ((select private.is_organization_owner(organization_id)));
create policy payer_mappings_insert_owners
  on public.payer_tenancy_mappings for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and (select private.is_organization_owner(organization_id))
  );
create policy payer_mappings_update_owners
  on public.payer_tenancy_mappings for update
  to authenticated
  using ((select private.is_organization_owner(organization_id)))
  with check ((select private.is_organization_owner(organization_id)));

create policy reconciliation_decisions_select_owners
  on public.reconciliation_decisions for select
  to authenticated
  using ((select private.is_organization_owner(organization_id)));
create policy reconciliation_decisions_insert_owners
  on public.reconciliation_decisions for insert
  to authenticated
  with check (
    decided_by = (select auth.uid())
    and (select private.is_organization_owner(organization_id))
  );

create policy audit_events_select_owners
  on public.audit_events for select
  to authenticated
  using ((select private.is_organization_owner(organization_id)));

revoke all on all tables in schema public from anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;
revoke all on schema private from anon;

grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

grant select on public.organizations to authenticated;
grant insert (name, created_by) on public.organizations to authenticated;
grant update (name, archived_at) on public.organizations to authenticated;

grant select on public.organization_memberships to authenticated;
grant insert (organization_id, user_id, role, created_by)
  on public.organization_memberships to authenticated;
grant update (revoked_at) on public.organization_memberships to authenticated;

grant select on public.properties, public.units, public.tenancies,
  public.tenancy_participants to authenticated;
grant insert (organization_id, display_name) on public.properties to authenticated;
grant update (display_name, archived_at) on public.properties to authenticated;
grant insert (organization_id, property_id, label) on public.units to authenticated;
grant update (label, archived_at) on public.units to authenticated;
grant insert (organization_id, unit_id, starts_on, ends_on) on public.tenancies to authenticated;
grant update (ends_on, archived_at) on public.tenancies to authenticated;
grant insert (organization_id, tenancy_id, user_id) on public.tenancy_participants to authenticated;
grant update (ended_at) on public.tenancy_participants to authenticated;

grant select on public.gmail_connections, public.gmail_sync_states,
  public.payment_source_events, public.payer_identities,
  public.payer_tenancy_mappings, public.reconciliation_decisions,
  public.audit_events to authenticated;
grant insert (organization_id, payer_identity_id, tenancy_id, created_by)
  on public.payer_tenancy_mappings to authenticated;
grant update (ended_at) on public.payer_tenancy_mappings to authenticated;
grant insert (organization_id, source_event_id, tenancy_id, outcome, decided_by, reason_code)
  on public.reconciliation_decisions to authenticated;

grant all on all tables in schema public to service_role;
grant usage on schema private to service_role;
grant all on all tables in schema private to service_role;

comment on function private.is_organization_owner(uuid) is
  'RLS-only owner check bound to auth.uid(). The private schema is not exposed by PostgREST.';
comment on function private.handle_new_auth_user() is
  'Privileged Auth trigger required to create a profile; no client role can execute it.';
