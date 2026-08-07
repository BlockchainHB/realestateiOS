# Canadian property-management iOS backend foundation

New to the project? Ask Codex: **“Read `HANDOFF.md` and do the handoff.”** It will explain what exists in plain language, guide the Supabase and Google Cloud setup one checkpoint at a time, and then help choose the next small milestone.

This repository currently contains the approved [product requirements](PRD.md) and the Supabase/Gmail beta foundation:

- passwordless-email and native Sign in with Apple readiness;
- organization-scoped profiles, membership, minimum tenancy references, and tested RLS;
- owner-only Gmail connection health and immutable payment-source intake;
- server-side Google OAuth with PKCE, encrypted refresh-token custody, Gmail watch/history processing, authenticated Pub/Sub push, and recovery maintenance;
- redacted synthetic parser fixtures that cannot be mistaken for production Interac formats;
- setup ADRs, cloud inventory, verification gates, and restricted-scope readiness checklist.

Google OAuth is not an app login method. It is an optional owner authorization used only to monitor supported Gmail notifications. A Gmail source event never becomes a ledger payment under this foundation.

Start with [the implementation plan](docs/implementation-plan.md), then follow [local setup](docs/setup/local-development.md) or [hosted development setup](docs/setup/hosted-development.md).
