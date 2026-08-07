# Verification evidence

Recorded on 2026-08-06 against branch `hasaam/supabase-google-oauth-foundation`.

## Toolchain

- Supabase CLI 2.109.0
- Deno 2.6.10
- Docker 29.7.2 on Colima
- Google Cloud SDK 579.0.0
- GitHub CLI 2.89.0

## Passing local gates

| Gate | Command | Result |
|---|---|---|
| Clean rebuild | `supabase db reset` | Pass; all three migrations and the synthetic seed applied to a recreated PostgreSQL 17 database. |
| Database authorization | `supabase test db` | Pass; 50 pgTAP assertions. |
| Schema lint | `supabase db lint --local --schema public,private --level warning --fail-on error` | Pass; no schema errors in the application-owned schemas. The extension schema is excluded because pgTAP's own compatibility warnings are not application code. |
| Security advisor | `supabase db advisors --local --type security --level info --fail-on error` | Pass; no error-level findings. The four informational no-policy findings are the intentionally inaccessible, forced-RLS tables in the non-exposed `private` schema. |
| Performance advisor | `supabase db advisors --local --type performance --level info --fail-on error` | Pass at the error threshold; no unindexed foreign keys remain. A freshly reset database reports the new and query-path indexes as unused until representative traffic exists. |
| Function formatting | `deno fmt --check supabase/functions` | Pass; 27 files checked. |
| Function type checks | `deno check --config supabase/functions/<function>/deno.json supabase/functions/<function>/index.ts` | Pass for all five Edge Functions. |
| Edge unit tests | `deno test --allow-env --allow-read=fixtures/gmail --config supabase/functions/gmail-oauth-start/deno.json supabase/functions/tests/parser_test.ts` | Pass; 14 tests. |
| Database concurrency | `SUPABASE_DB_URL=<local-db-url> deno test --allow-env --allow-net=127.0.0.1:54322 --config supabase/functions/gmail-oauth-start/deno.json supabase/functions/tests/database_concurrency_test.ts` | Pass; four race/recovery tests cover last-owner serialization, disconnect winning over token refresh, stale Pub/Sub receipt reclamation, and final-organization provider cleanup. |
| Whitespace | `git diff --check` | Pass. |

The database suite covers owner, manager, active tenant, former tenant, outsider,
cross-organization, anonymous, private-schema, append-only, and replay paths.
The Edge suite covers synthetic completed/reversal/unsupported/unrelated message
handling, OAuth PKCE and exact-scope parameters, authenticated encryption and
tamper detection, Pub/Sub envelope validation, and constant-time secret checks.
Gmail synchronization tests also pin the INBOX history filter and the single
refresh-and-retry path for nominally unexpired access tokens rejected with 401.
The production parser boundary is also verified to reject the test-only
synthetic fixture grammar as unsupported.
Database race coverage also verifies that a completed refresh cannot restore
credentials after disconnect and that abandoned notification work is reclaimed
only after its processing lease expires.

## Local perimeter smoke checks

- `gmail-oauth-start` without a JWT returns HTTP 401.
- `gmail-oauth-callback` without OAuth parameters returns HTTP 400.
- `gmail-pubsub` without an OIDC bearer token returns HTTP 401.
- `gmail-maintenance` without locally configured server secrets returns the
  generic HTTP 500 response; secret comparison itself is covered by unit tests.

No real Google credentials, mailbox, tenant, or payment data was used.

## Not performed

Hosted Supabase migration/function deployment, live Google consent, Gmail
watch/history delivery, authenticated Pub/Sub push, Scheduler execution, and
native iOS sign-in cannot be honestly claimed from local tests. They require the
account-owner selections and credentials listed in
[remaining user-owned actions](../remaining-user-actions.md).
