# Local development setup

## Prerequisites

- Supabase CLI 2.109.0 or newer
- Docker-compatible runtime (Docker Desktop or Colima)
- Deno 2.6 or newer

## Start from a clean database

```sh
supabase start
supabase db reset
supabase test db
deno test --allow-read --allow-env supabase/functions/tests
```

The seed creates only an `example.test` synthetic owner and portfolio. It contains no tenant, Gmail, payment, credential, or provider data.

## Edge Function configuration

Copy `.env.example` to an ignored local environment file and populate values through a secure local secret store. Never commit the populated file. Generate `GMAIL_TOKEN_ENCRYPTION_KEY` as 32 random bytes encoded with base64url. The following are supplied automatically by hosted Supabase and must still be available when serving functions locally:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`
- `SUPABASE_DB_URL`

Serve functions through the Supabase CLI only after providing non-production Google credentials. Do not use a production OAuth client or real mailbox for local tests.

## Authentication foundation

Local configuration enables confirmed passwordless email and includes Apple provider readiness without enabling or committing Apple credentials. Native Sign in with Apple requires the future Xcode bundle identifier, Apple Developer capability, and hosted Supabase provider configuration.
