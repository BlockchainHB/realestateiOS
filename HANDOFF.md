# Project handoff for a first-time builder

This file is a conversation guide for Codex. When the new owner says **“do the handoff”**, read this entire file and lead the handoff interactively. Assume they are new to coding and to Codex.

## How Codex should run the handoff

- Use plain language first. Define a technical word immediately if it is unavoidable.
- Have a back-and-forth conversation; do not dump the whole guide into one answer.
- Ask at most two short questions at a time.
- Give one safe action at a time, explain why it matters, and wait for confirmation or a screenshot before continuing.
- Inspect the repository and current provider state where possible instead of asking the learner to interpret technical output.
- Never ask them to paste passwords, API secrets, private keys, database URLs, access tokens, or the contents of a populated environment file into chat.
- Stop before accepting billing, choosing a paid plan, changing a production project, publishing an OAuth app, or deleting anything. Explain the choice and ask for explicit approval.
- Use a separate development Supabase project and Google Cloud project. Never reuse production credentials.
- Keep a short checklist in the conversation showing what is complete, what is blocked, and what comes next.
- If an action fails, explain the failure in ordinary language before proposing a fix.
- Do not start feature development until Parts 1 and 2 are understood and Part 3 is either verified or clearly marked as blocked.

## Part 1 — Explain what this project is

Start with this idea, in your own words:

> This project is the secure backend foundation for an iPhone property-management app for Canadian landlords, managers, and tenants. It is not yet the finished iPhone app. The foundation decides who may see each piece of information and prepares a safe way for an owner to connect Gmail so future Interac e-Transfer notifications can be reviewed and matched to rent.

Then explain these points one small section at a time:

1. **The problem:** landlords currently piece together rent status, emails, spreadsheets, and maintenance updates. The planned app brings those jobs into one place.
2. **Who uses it:** owners control a portfolio; managers see only assigned properties and never rent amounts; tenants see only their own tenancy information.
3. **What is already built:** the Supabase database structure, organization and role permissions, Gmail connection plumbing, encrypted Google token storage, Gmail notification/recovery plumbing, synthetic tests, and safety documentation.
4. **What Gmail does:** Gmail is not used to sign in. An owner separately permits the app to read the narrow Gmail data needed for supported payment notifications. The foundation does not keep unrelated mailbox contents.
5. **What payment intake does not do yet:** an email event does not automatically become a rent payment. The future app must let the owner review and match it first.
6. **What is not built yet:** the SwiftUI iPhone interface and most product areas—properties and units, the full rental ledger, payment inbox screens, maintenance workflow, notifications, and production-ready Interac parsing.
7. **Why the tests matter:** they check that unrelated organizations and roles cannot see each other’s data and that overlapping Gmail actions cannot accidentally restore or overwrite credentials.

Pause after each section for questions. Before setup, ask the learner to describe the project back in their own words. Correct misunderstandings gently. Continue only after they confirm that the boundary between “secure backend foundation” and “finished app” is clear.

Useful source documents:

- `README.md` — short current-state summary
- `PRD.md` — complete product vision and acceptance criteria
- `docs/implementation-plan.md` — what this foundation owns
- `docs/adr/` — important security and architecture decisions
- `docs/verification/evidence.md` — checks already run

## Part 2 — Establish safe working habits

Confirm these rules together before touching a cloud console:

1. Work in a feature branch and use a pull request; do not experiment directly on `main`.
2. Let Codex inspect changes, run focused tests, and summarize them in plain language before a push.
3. Never commit a populated `.env` file, credentials, real emails, tenant data, or unredacted Interac messages.
4. Share screenshots only after checking that they contain no secrets or private customer information.
5. Use synthetic data until the development setup is working.
6. Ask before any paid, destructive, public, or production action.

Confirm the checkout is clean and that the learner can locate `README.md`, `PRD.md`, and this file. If local development will be used, guide them through the prerequisites in `docs/setup/local-development.md` and verify each installation rather than assuming it worked.

## Part 3 — Set up Supabase and Google Cloud

Treat the steps below as a route map, not a single instruction dump. Perform one numbered step, verify it, record the result, and only then continue.

### A. Create the Supabase development project

1. Sign in to Supabase and ask which Supabase organization should own this app. Do not infer the organization.
2. Create a project named `realestate-ios-dev` in Canada Central (`ca-central-1`). Stop for approval if a paid plan or billing change is requested.
3. Record the project reference in a private local note; do not commit it unless it is intentionally non-secret configuration.
4. In the repository, authenticate the Supabase CLI, link the checkout with `supabase link --project-ref <development-ref>`, and verify the linked project name before continuing.
5. Preview and then apply the repository migrations with `supabase db push`.
6. Confirm that the Data API exposes only `public` and `graphql_public`. The `private` schema must not be exposed.
7. Configure development passwordless email delivery before inviting another tester. Leave Sign in with Apple for later, when Apple identifiers exist.

Checkpoint: verify migrations are current, the project is in Canada Central, and no secrets were added to Git.

### B. Create the Google Cloud development project

1. Sign in to Google Cloud and select or create a dedicated development project. Do not use an unrelated or production project.
2. Configure Google Auth Platform in **Testing** mode and add only explicitly approved Gmail test users.
3. Enable the Gmail API and Cloud Pub/Sub API.
4. Create a Pub/Sub topic named `gmail-mailbox-updates-dev`.
5. Grant `roles/pubsub.publisher` on that topic to `gmail-api-push@system.gserviceaccount.com`.
6. Create a service account named `gmail-push-invoker` for authenticated push delivery.
7. Create a push subscription named `gmail-mailbox-updates-edge-dev` that targets the hosted `gmail-pubsub` Edge Function.
8. Configure the subscription to send an OIDC token from `gmail-push-invoker`, with the exact function URL as its audience. Grant the Pub/Sub service agent permission to mint that identity token.

Checkpoint: verify the project is still in Testing mode, the approved test user is listed, both APIs are enabled, and the topic and push identity match `docs/cloud-resource-inventory.md`.

### C. Connect Google OAuth to Supabase

1. In Google Auth Platform, create a **Web application** OAuth client named `realestate-ios-dev-server`.
2. Set its development redirect URI to the exact hosted `gmail-oauth-callback` function URL. Do not add broad or wildcard redirects.
3. Configure exactly the Gmail read-only scope: `https://www.googleapis.com/auth/gmail.readonly`.
4. Keep the client ID and client secret in the provider secret stores. Never place the client secret in the iOS app or commit it.
5. Generate a 32-byte base64url token-encryption key and a separate strong maintenance secret using a secure local command. Do not print either value back into chat.
6. Set every required Supabase Edge Function secret listed in `.env.example`. Explain each value as it is entered and obtain Supabase-generated values from the project settings rather than guessing them.
7. Deploy these five functions using their settings in `supabase/config.toml`:
   - `gmail-oauth-start`
   - `gmail-oauth-callback`
   - `gmail-connection`
   - `gmail-pubsub`
   - `gmail-maintenance`
8. Recheck that authenticated functions require Supabase authentication and that the callback, Pub/Sub, and maintenance functions enforce their own narrow checks as documented.
9. Schedule authenticated maintenance calls: `renew_watches` daily and `recovery_sync` every 15 minutes. Store the maintenance secret outside source control.

Checkpoint: compare secret names with `.env.example`, list the deployed functions, run database advisors, and confirm no secret or populated environment file appears in `git status` or `git diff`.

### D. Prove the development setup

1. Run the repository verification commands from `docs/setup/local-development.md` and `docs/verification/evidence.md` where the local prerequisites are available.
2. Use only the approved Gmail test account to start the OAuth flow.
3. Confirm that consent names only Gmail read-only access and returns to the expected development callback.
4. Confirm connection health and an authenticated test notification without exposing message contents or credentials in logs.
5. Run Supabase security and performance advisors and explain any finding before changing code.
6. Mark real Google testing as incomplete if it was not actually performed. Automated repository tests are not proof that the hosted OAuth flow works.

Do not publish the OAuth app. Public use still requires the release work in `docs/production-readiness-checklist.md` and may require Google verification or a security assessment.

## Part 4 — Agree on the next build steps

Only begin this section after the learner confirms the explanation and the development setup is verified or its blockers are written down.

Walk through this recommended order and let the learner choose the next small milestone:

1. Build the native SwiftUI app shell, passwordless sign-in, and organization/role switching.
2. Build owner property, unit, tenancy, and invitation flows against the existing permission model.
3. Add the effective-dated rental ledger and manual “mark as paid” workflow.
4. Obtain carefully redacted real Interac examples and implement the production parser boundary without storing unrelated email bodies.
5. Build the owner Payment Inbox and payer-matching review flow before enabling any automatic reconciliation.
6. Build manager and tenant projections, then prove that hidden financial data is absent from the API—not merely hidden on screen.
7. Build the structured non-emergency maintenance workflow and private photo storage.
8. Add notifications, accessibility QA, hosted beta testing, and the public-release checklist.

For the chosen milestone, create a short plan with:

- the user-visible outcome;
- what is deliberately excluded;
- the smallest end-to-end slice;
- the files and backend areas likely involved;
- tests and manual checks;
- any account-owner decision or cost that requires approval.

End the handoff with a plain-language recap, the checklist status, and exactly one agreed next milestone. Do not start coding until the learner explicitly says to begin it.
