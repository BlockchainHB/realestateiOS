# Gmail beta production-readiness checklist

## Implementation and security

- [ ] Add a production Interac parser only after receiving authorized, redacted real examples and recording a new parser version.
- [ ] Complete threat modelling for OAuth state, token custody, Pub/Sub replay, data deletion, and support access.
- [ ] Confirm no token, code, verifier, email body, or secret enters logs, analytics, screenshots, fixtures, or crash reports.
- [ ] Verify owner, manager, tenant, former-tenant, anonymous, and cross-organization authorization against the hosted project.
- [ ] Verify Gmail source-metadata deletion and account-deletion runtime behavior before App Store submission.
- [ ] Establish the Canadian legal retention schedule; Canada-region hosting alone is not a compliance claim.

## Google verification

- [ ] Finalize a verified public domain, homepage, privacy policy, terms, support email, and legal business identity.
- [ ] Explain that Gmail authorization is optional, owner-only, and unrelated to app login.
- [ ] Submit the exact `gmail.readonly` scope justification and explain why `gmail.metadata` cannot read Interac bodies.
- [ ] Provide a demonstration video/script covering connect, consent, source processing, health, disconnect, revocation, and deletion.
- [ ] Confirm Google Workspace API User Data Policy and Limited Use compliance.
- [ ] Complete restricted-scope OAuth verification.
- [ ] Complete the required annual security assessment for server-side restricted-scope data.
- [ ] Move the production OAuth project/client/topic/subscription to separate resources after approval.
- [ ] Remove testing-mode user limits only after verification approval; do not launch through the unverified warning path.

## Operations

- [ ] Alert on failed token refresh, expiring watch, delayed sync, Pub/Sub retry growth, and recovery-sync failure.
- [ ] Verify daily watch renewal and periodic recovery jobs over at least eight days.
- [ ] Document key rotation, OAuth client-secret rotation, token-encryption-key rotation, and incident revocation.
- [ ] Run Supabase security/performance advisors and resolve all relevant findings.
- [ ] Complete a TestFlight beta with explicitly authorized Google test users.
