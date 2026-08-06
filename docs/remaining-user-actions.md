# Remaining user-owned actions

Implementation deliberately stops before account-owner choices that cannot be inferred safely.

1. **Identify the Supabase organization** that should own the new `realestate-ios-dev` Canada Central project. The authenticated account currently belongs to multiple organizations and none is unambiguously this app's owner.
2. **Complete Google Cloud authentication and select/create the dedicated development project.** No authenticated `gcloud` session was available during initial implementation.
3. **Approve any billing prompt** if either provider requires a paid plan for the selected resources. No billing acceptance is automated.
4. **Provide one Gmail test-user address through the Google Console UI** if it cannot be safely inferred from the authenticated account. Do not send its password or any secret in chat.
5. **Provide Apple Developer identifiers/keys later** for hosted native Sign in with Apple; they are not required for the Gmail foundation.
6. **Provide verified domain, privacy-policy URL, support email, and legal identity** only when beginning public Google verification.
7. **Provide redacted real Interac notification examples** only after synthetic infrastructure is accepted. Remove names, email addresses, transaction numbers, and any unrelated content before transfer.
