# Hosted development setup

## Supabase

1. Create a dedicated development project in Canada Central (`ca-central-1`) under the confirmed owner organization.
2. Keep the future production project separate; do not reuse project references, API keys, OAuth callbacks, or Gmail topics.
3. Link this checkout with `supabase link --project-ref <development-ref>` and push migrations with `supabase db push`.
4. Configure passwordless email delivery with a development SMTP provider before external testing.
5. Configure native Sign in with Apple only after the Apple bundle/service identifiers and key are available.
6. Set Edge Function secrets from `.env.example` names. Never expose secret/service keys or OAuth values to the iOS build.
7. Deploy all five functions and retain `public` and `graphql_public` as the only Data API exposed schemas.
8. Run database advisors and the linked authorization tests before inviting beta users.

## Google Cloud development project

1. Create a separate development Google Cloud project and configure Google Auth Platform in Testing mode.
2. Add only explicitly authorized test-user email addresses.
3. Enable Gmail API and Cloud Pub/Sub API.
4. Create a Web application OAuth client with the exact HTTPS `gmail-oauth-callback` URL as its only development redirect URI.
5. Add exactly `https://www.googleapis.com/auth/gmail.readonly` to the consent configuration.
6. Create the topic and grant `roles/pubsub.publisher` on it to `gmail-api-push@system.gserviceaccount.com`.
7. Create a dedicated push-auth service account and push subscription targeting `gmail-pubsub`.
8. Configure OIDC authentication with the exact endpoint audience. Grant the Pub/Sub service agent permission to mint an identity token for the push-auth service account.
9. Schedule authenticated daily `renew_watches` and fifteen-minute `recovery_sync` calls to `gmail-maintenance`, storing the maintenance secret outside source control.

## Testing-mode limitation

Development/testing is not public launch approval. Restricted-scope verification and any required security assessment remain release gates. Google may impose testing-mode user and token limitations; connection health must surface reauthorization rather than hiding failures.
