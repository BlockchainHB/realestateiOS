export const GMAIL_READONLY_SCOPE =
  "https://www.googleapis.com/auth/gmail.readonly";

export function requireEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) {
    throw new Error(`Missing required server configuration: ${name}`);
  }
  return value;
}

export function databaseUrl(): string {
  return requireEnv("SUPABASE_DB_URL");
}

export function oauthConfig() {
  return {
    clientId: requireEnv("GOOGLE_OAUTH_CLIENT_ID"),
    clientSecret: requireEnv("GOOGLE_OAUTH_CLIENT_SECRET"),
    redirectUri: requireEnv("GOOGLE_OAUTH_REDIRECT_URI"),
  };
}

export function pubsubConfig() {
  return {
    audience: requireEnv("GOOGLE_PUBSUB_AUDIENCE"),
    serviceAccountEmail: requireEnv("GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL"),
  };
}
