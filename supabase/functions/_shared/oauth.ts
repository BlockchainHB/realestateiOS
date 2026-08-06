import { GMAIL_READONLY_SCOPE, oauthConfig, requireEnv } from "./config.ts";
import { HttpError } from "./http.ts";

export interface GoogleTokenBundle {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  scopes: string[];
}

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(
  parameters: URLSearchParams,
): Promise<GoogleTokenResponse> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: parameters,
  });
  const result = await response.json() as GoogleTokenResponse;
  if (!response.ok || result.error) {
    throw new HttpError(
      502,
      "google_token_exchange_failed",
      "Google did not complete the token exchange.",
    );
  }
  return result;
}

export function buildGoogleAuthorizationUrl(input: {
  state: string;
  codeChallenge: string;
}): string {
  const config = oauthConfig();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: GMAIL_READONLY_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

export async function exchangeAuthorizationCode(
  code: string,
  codeVerifier: string,
): Promise<GoogleTokenBundle> {
  const config = oauthConfig();
  const result = await tokenRequest(
    new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      code_verifier: codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri,
    }),
  );
  if (!result.access_token || !result.refresh_token || !result.expires_in) {
    throw new HttpError(
      409,
      "google_refresh_token_missing",
      "Google did not issue the offline-access token required for background synchronization.",
    );
  }
  const scopes = (result.scope ?? "").split(/\s+/u).filter(Boolean);
  if (!scopes.includes(GMAIL_READONLY_SCOPE)) {
    throw new HttpError(
      409,
      "google_scope_missing",
      "The required read-only Gmail permission was not granted.",
    );
  }
  return {
    accessToken: result.access_token,
    refreshToken: result.refresh_token,
    expiresAt: new Date(Date.now() + result.expires_in * 1_000).toISOString(),
    scopes,
  };
}

export async function refreshGoogleToken(
  bundle: GoogleTokenBundle,
): Promise<GoogleTokenBundle> {
  const config = oauthConfig();
  const result = await tokenRequest(
    new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: bundle.refreshToken,
      grant_type: "refresh_token",
    }),
  );
  if (!result.access_token || !result.expires_in) {
    throw new HttpError(
      502,
      "google_token_refresh_failed",
      "Google did not refresh Gmail access.",
    );
  }
  return {
    accessToken: result.access_token,
    refreshToken: bundle.refreshToken,
    expiresAt: new Date(Date.now() + result.expires_in * 1_000).toISOString(),
    scopes: result.scope?.split(/\s+/u).filter(Boolean) ?? bundle.scopes,
  };
}

export async function revokeGoogleToken(token: string): Promise<void> {
  const response = await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  });
  if (!response.ok && response.status !== 400) {
    throw new HttpError(
      502,
      "google_revocation_failed",
      "Google access revocation did not complete.",
    );
  }
}

export async function gmailApi<T>(
  bundle: GoogleTokenBundle,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me${path}`,
    {
      ...init,
      headers: {
        authorization: `Bearer ${bundle.accessToken}`,
        "content-type": "application/json",
        ...init.headers,
      },
    },
  );
  if (!response.ok) {
    const code = response.status === 401
      ? "gmail_reauthorization_required"
      : "gmail_api_failed";
    throw new HttpError(
      response.status === 401 ? 401 : 502,
      code,
      "Gmail could not complete the requested operation.",
    );
  }
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

export async function readGoogleMailboxIdentity(
  bundle: GoogleTokenBundle,
): Promise<{
  emailAddress: string;
  historyId: string;
}> {
  return await gmailApi(bundle, "/profile");
}

export async function startGmailWatch(bundle: GoogleTokenBundle): Promise<{
  historyId: string;
  expiration: string;
}> {
  return await gmailApi(bundle, "/watch", {
    method: "POST",
    body: JSON.stringify({
      topicName: requireEnv("GMAIL_PUBSUB_TOPIC"),
      labelIds: ["INBOX"],
      labelFilterBehavior: "INCLUDE",
    }),
  });
}

export async function stopGmailWatch(bundle: GoogleTokenBundle): Promise<void> {
  await gmailApi(bundle, "/stop", { method: "POST", body: "{}" });
}
