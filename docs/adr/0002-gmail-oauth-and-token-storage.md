# ADR 0002: Gmail OAuth and token storage

- Status: Accepted
- Date: 2026-08-06

## Context

The iOS app cannot safely hold a Google client secret or refresh token. Background Gmail history processing requires offline access, and `gmail.readonly` remains a restricted scope because message bodies are needed to parse supported Interac notifications.

## Decision

Use a Google OAuth **Web application** client whose exact HTTPS redirect URI is the `gmail-oauth-callback` Edge Function. The native app asks the authenticated `gmail-oauth-start` function for an authorization URL and opens it in the system authorization session. Google never redirects an authorization code directly to client code.

The start function:

- verifies an active organization owner;
- creates 256-bit state and a high-entropy PKCE verifier;
- stores only the state hash plus an AES-256-GCM encrypted verifier in `private` for ten minutes;
- requests only `gmail.readonly`, with offline access and explicit consent.

The callback atomically consumes the one-time state, exchanges the code in the server boundary, verifies the granted scope, reads the canonical mailbox identity, starts the Gmail watch, revalidates the owner, and stores an application-encrypted token bundle in `private.gmail_oauth_tokens`.

The encryption key and Google client secret are Edge Function secrets. The private schema is absent from Data API exposed schemas, grants no token-table privileges to `anon` or `authenticated`, and is accessed through the server database connection only. Tokens, codes, verifiers, and message bodies are prohibited from logs, API responses, audit metadata, screenshots, fixtures, and commits.

Pub/Sub push uses a dedicated service account and authenticated push. The endpoint validates Google's signature, issuer, exact audience, verified service-account email, subscription name, and message shape before processing Gmail history. Provider message identity and Pub/Sub message identity make retries harmless.

## Watch and recovery

Watches are selected for renewal two days before expiry and should be scheduled daily. Recovery synchronization calls `history.list` for connections without a recent successful sync. If Google can no longer serve the cursor, the connection moves to a delayed/reauthorization-safe state; this foundation does not perform a speculative full-mailbox scan.

One Google mailbox may serve multiple organizations, while Gmail watches and OAuth revocation are mailbox/provider-wide. Connect, disconnect, and failed-callback cleanup transitions therefore serialize on the canonical Google account identity. Disconnect is local for one organization while another active connection remains; watch shutdown and grant revocation occur only when no active organization depends on the mailbox. A pending final revocation blocks reconnect until provider cleanup succeeds.

## Parser boundary

Deployed intake contains no synthetic or speculative Interac grammar. Suspected Interac messages remain unsupported and are stored with a content hash, not a body, until an approved versioned production parser exists. Redacted synthetic fixtures are exercised only through a test-tree adapter that deployed functions never import. Unrelated messages are not retained. No source event is a ledger payment, and reversals/cancellations always start in owner review.

## References

- [Google web-server OAuth flow](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)
- [Gmail push notifications](https://developers.google.com/workspace/gmail/api/guides/push)
- [Authenticated Pub/Sub push](https://docs.cloud.google.com/pubsub/docs/authenticate-push-subscriptions)
- [Supabase Edge Function secrets](https://supabase.com/docs/guides/functions/secrets)
