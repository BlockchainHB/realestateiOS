# Development cloud resource inventory

Names are proposed and contain no credentials. Replace `<supabase-ref>` and `<gcp-project-id>` only after the correct owner organization is confirmed.

| Provider | Resource | Proposed name | Purpose |
|---|---|---|---|
| Supabase | Project | `realestate-ios-dev` | Canada Central development Auth, database, and Edge Functions |
| Supabase | Edge Function | `gmail-oauth-start` | Owner-authenticated OAuth initiation |
| Supabase | Edge Function | `gmail-oauth-callback` | HTTPS Google OAuth callback and server token exchange |
| Supabase | Edge Function | `gmail-connection` | Owner-only health and disconnect/revoke API |
| Supabase | Edge Function | `gmail-pubsub` | Authenticated Gmail notification receiver |
| Supabase | Edge Function | `gmail-maintenance` | Watch renewal and recovery synchronization |
| Google Cloud | Project | `<gcp-project-id>` | Isolated Gmail beta development project |
| Google Cloud | OAuth client | `realestate-ios-dev-server` | Confidential Web client for Edge callback |
| Google Cloud | Pub/Sub topic | `gmail-mailbox-updates-dev` | Gmail watch publication target |
| Google Cloud | Service account | `gmail-push-invoker` | OIDC identity for authenticated push |
| Google Cloud | Push subscription | `gmail-mailbox-updates-edge-dev` | Delivers topic messages to `gmail-pubsub` |
| Scheduler | Daily job | `gmail-watch-renewal-dev` | Renews watches before the seven-day limit |
| Scheduler | 15-minute job | `gmail-recovery-sync-dev` | Recovers delayed or missed notifications |
