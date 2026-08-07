import { decryptJson, encryptJson, sha256Hex } from "./crypto.ts";
import { database } from "./database.ts";
import type { GoogleTokenBundle } from "./oauth.ts";

export interface OAuthAuthorizationState {
  organizationId: string;
  userId: string;
  codeVerifier: string;
  returnUrl: string;
  intentStateHash: string;
}

export async function storeAuthorizationState(
  input: Omit<OAuthAuthorizationState, "intentStateHash"> & {
    state: string;
  },
): Promise<void> {
  const sql = database();
  const stateHash = await sha256Hex(input.state);
  const verifierCiphertext = await encryptJson({
    codeVerifier: input.codeVerifier,
  });
  await sql.begin(async (transaction) => {
    await transaction`
      select pg_advisory_xact_lock(
        hashtextextended(${"gmail-org:" + input.organizationId}, 0)
      )
    `;
    await transaction`
      delete from private.gmail_oauth_authorization_states
      where expires_at <= now()
    `;
    await transaction`
      delete from private.gmail_connection_intents
      where expires_at <= now()
    `;
    await transaction`
      insert into private.gmail_oauth_authorization_states (
        state_hash,
        organization_id,
        user_id,
        verifier_ciphertext,
        return_url,
        expires_at
      ) values (
        ${stateHash},
        ${input.organizationId},
        ${input.userId},
        ${verifierCiphertext},
        ${input.returnUrl},
        now() + interval '10 minutes'
      )
    `;
    await transaction`
      insert into private.gmail_connection_intents (
        organization_id,
        state_hash,
        requested_by,
        expires_at
      ) values (
        ${input.organizationId},
        ${stateHash},
        ${input.userId},
        now() + interval '10 minutes'
      )
      on conflict (organization_id) do update
      set state_hash = excluded.state_hash,
          requested_by = excluded.requested_by,
          expires_at = excluded.expires_at,
          created_at = now()
    `;
  });
}

export async function consumeAuthorizationState(
  state: string,
): Promise<OAuthAuthorizationState | null> {
  const sql = database();
  const stateHash = await sha256Hex(state);
  const rows = await sql<{
    organization_id: string;
    user_id: string;
    verifier_ciphertext: string;
    return_url: string;
  }[]>`
    delete from private.gmail_oauth_authorization_states
    where state_hash = ${stateHash}
      and expires_at > now()
    returning organization_id, user_id, verifier_ciphertext, return_url
  `;
  const row = rows[0];
  if (!row) return null;
  const decrypted = await decryptJson<{ codeVerifier: string }>(
    row.verifier_ciphertext,
  );
  return {
    organizationId: row.organization_id,
    userId: row.user_id,
    codeVerifier: decrypted.codeVerifier,
    returnUrl: row.return_url,
    intentStateHash: stateHash,
  };
}

export async function loadToken(
  connectionId: string,
  sql = database(),
): Promise<GoogleTokenBundle | null> {
  const rows = await sql<{ token_ciphertext: string }[]>`
    select token_ciphertext
    from private.gmail_oauth_tokens
    where connection_id = ${connectionId}
  `;
  return rows[0]
    ? await decryptJson<GoogleTokenBundle>(rows[0].token_ciphertext)
    : null;
}

export async function saveToken(
  connectionId: string,
  bundle: GoogleTokenBundle,
  sql = database(),
): Promise<boolean> {
  const ciphertext = await encryptJson(bundle);
  return await sql.begin(async (transaction) => {
    const activeConnections = await transaction<{ id: string }[]>`
      select id
      from public.gmail_connections
      where id = ${connectionId}
        and status <> 'disconnected'
      for update
    `;
    if (!activeConnections[0]) return false;

    await transaction`
      insert into private.gmail_oauth_tokens (
        connection_id,
        token_ciphertext,
        access_token_expires_at,
        granted_scopes
      ) values (
        ${connectionId},
        ${ciphertext},
        ${bundle.expiresAt},
        ${bundle.scopes}
      )
      on conflict (connection_id) do update
      set token_ciphertext = excluded.token_ciphertext,
          access_token_expires_at = excluded.access_token_expires_at,
          granted_scopes = excluded.granted_scopes,
          updated_at = now()
    `;
    return true;
  });
}
