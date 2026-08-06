# Supabase and Gmail foundation implementation plan

## Canonical owners

- **Identity and Membership** owns profiles, organizations, memberships, role grants, and revocation. Authorization reads database membership, never user-editable metadata.
- **Portfolio/Tenancy foundation** owns the minimum property, unit, tenancy, and participant references required to bind payer mappings to a real organization context.
- **Payment Intake** owns Gmail connection health, OAuth token custody, mailbox watch/history state, parsing, immutable source events, and payer identities. It never creates ledger payments.
- **Reconciliation** owns append-only review decisions and payer-to-tenancy mappings. Every parsed source event starts in owner review under this foundation.

## Module shape

- SQL migrations establish public RLS-protected records and a non-exposed `private` schema for encrypted OAuth tokens, one-time authorization state, and Pub/Sub receipts.
- Authenticated Edge Functions start Gmail authorization and expose owner-only health/disconnect operations.
- Public callback and Pub/Sub functions implement their own narrow trust checks: one-time state plus PKCE for OAuth, and Google-signed OIDC JWT validation for Pub/Sub.
- Shared server modules own OAuth, envelope encryption, Gmail API access, history synchronization, synthetic-only parsing, idempotent source-event insertion, and watch/recovery maintenance.
- A single maintenance endpoint supports two explicit scheduled actions: daily watch renewal and recovery history synchronization.

## Complexity deliberately avoided

- No generic permission engine, provider abstraction framework, queue platform, full property model, rental ledger, or automatic allocation engine.
- No public `SECURITY DEFINER` RPCs and no token access through PostgREST.
- No mailbox copies, unrelated-message retention, full-body persistence, or speculative production Interac parser.
- No hidden manager amount fields: Gmail/source/payer tables are owner-only at the database boundary.
- No OAuth use as application login; Supabase Auth remains passwordless email plus native Sign in with Apple readiness.

## Verification strategy

1. Reset a clean local Supabase database and apply migrations plus synthetic seed data.
2. Run pgTAP authorization tests as owner, manager, tenant, former tenant, unrelated user, and another-organization owner.
3. Prove immutable source/audit history, one-inbox-per-organization, last-owner protection, deliberate Data API grants, and inaccessible private tokens.
4. Run Deno type checks and tests for the parser boundary, PKCE/offline OAuth URL, scope exactness, and authenticated encryption.
5. Exercise duplicate Gmail message identities and Pub/Sub receipt behavior without calling live Google services.
6. Run database lint/advisors, formatting, secret scans, repository consistency checks, and `git diff --check`.
7. Deploy only after the user identifies the correct Supabase organization and completes any unavoidable Google Cloud login/project choices.
