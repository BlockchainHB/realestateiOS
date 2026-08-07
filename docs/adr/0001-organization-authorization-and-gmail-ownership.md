# ADR 0001: Organization authorization and Gmail ownership

- Status: Accepted
- Date: 2026-08-06

## Decision

Organization membership rows are the canonical authorization source. A user can hold independent owner, manager, and tenant memberships, but only an active owner membership grants access to Gmail connections, synchronization state, payment source events, payer identities, reconciliation data, or sensitive audit events.

Every organization-owned row carries one `organization_id`. Composite foreign keys prevent a connection, tenancy, payer, or decision from referencing a record in another organization. Client update grants omit organization and identity columns, and triggers reject ownership or organization reassignment as defense in depth.

The initial organization creator may bootstrap the first owner membership. Subsequent membership changes require an existing active owner, and a trigger prevents revoking the final active owner. User-editable Auth metadata is not consulted.

## RLS helper boundary

RLS uses small `SECURITY DEFINER` predicate functions in the non-exposed `private` schema to avoid recursive membership policies. Each helper binds to `auth.uid()`, uses an empty `search_path`, has `PUBLIC` execution revoked, and exposes no mutation capability. No privileged function exists in `public`.

## Gmail ownership

The public connection and health tables are read-only to authenticated clients and have owner-only select policies. Creation, token changes, synchronization, and disconnection happen in trusted Edge Functions after explicit owner validation. Managers and tenants receive zero Gmail/source rows rather than filtered payloads.

## Consequences

- The same person can safely hold different roles across organizations.
- Ending a tenancy removes tenancy visibility independently of organization role labels.
- A future manager property-assignment model can extend Portfolio RLS without weakening Gmail boundaries.
- Organization ownership transfer requires an explicit future workflow; changing `created_by` is intentionally impossible.
