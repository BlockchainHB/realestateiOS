import { encryptJson } from "./crypto.ts";
import { database } from "./database.ts";
import { HttpError } from "./http.ts";
import type { GoogleTokenBundle } from "./oauth.ts";

export interface GmailConnectionRow {
  id: string;
  organization_id: string;
  inbox_email: string;
  status:
    | "connected"
    | "needs_reauthorization"
    | "sync_delayed"
    | "disconnected";
  last_successful_sync_at: string | null;
}

export async function connectMailbox(input: {
  organizationId: string;
  userId: string;
  providerAccountId: string;
  inboxEmail: string;
  bundle: GoogleTokenBundle;
  watch: { historyId: string; expiration: string };
}): Promise<string> {
  const sql = database();
  const tokenCiphertext = await encryptJson(input.bundle);
  return await sql.begin(async (transaction) => {
    const owners = await transaction<{ id: string }[]>`
      select id
      from public.organization_memberships
      where organization_id = ${input.organizationId}
        and user_id = ${input.userId}
        and role = 'owner'
        and revoked_at is null
      limit 1
    `;
    if (!owners[0]) {
      throw new HttpError(
        403,
        "owner_required",
        "Owner access ended before Gmail authorization completed.",
      );
    }

    const connections = await transaction<{ id: string }[]>`
      insert into public.gmail_connections (
        organization_id,
        provider_account_id,
        inbox_email,
        status,
        connected_by,
        connected_at,
        disconnected_at,
        needs_reauthorization_at,
        last_error_code
      ) values (
        ${input.organizationId},
        ${input.providerAccountId},
        ${input.inboxEmail.toLowerCase()},
        'connected',
        ${input.userId},
        now(),
        null,
        null,
        null
      )
      on conflict (organization_id) do update
      set provider_account_id = excluded.provider_account_id,
          inbox_email = excluded.inbox_email,
          status = 'connected',
          connected_by = excluded.connected_by,
          connected_at = now(),
          disconnected_at = null,
          needs_reauthorization_at = null,
          last_error_code = null
      returning id
    `;
    const connectionId = connections[0]?.id;
    if (!connectionId) {
      throw new Error("Gmail connection upsert returned no identifier");
    }

    await transaction`
      insert into private.gmail_oauth_tokens (
        connection_id,
        token_ciphertext,
        access_token_expires_at,
        granted_scopes
      ) values (
        ${connectionId},
        ${tokenCiphertext},
        ${input.bundle.expiresAt},
        ${input.bundle.scopes}
      )
      on conflict (connection_id) do update
      set token_ciphertext = excluded.token_ciphertext,
          access_token_expires_at = excluded.access_token_expires_at,
          granted_scopes = excluded.granted_scopes,
          updated_at = now()
    `;

    await transaction`
      insert into public.gmail_sync_states (
        connection_id,
        organization_id,
        last_history_id,
        watch_expiration,
        status,
        consecutive_failures
      ) values (
        ${connectionId},
        ${input.organizationId},
        ${input.watch.historyId},
        to_timestamp(${input.watch.expiration}::numeric / 1000),
        'idle',
        0
      )
      on conflict (connection_id) do update
      set organization_id = excluded.organization_id,
          last_history_id = excluded.last_history_id,
          watch_expiration = excluded.watch_expiration,
          status = 'idle',
          consecutive_failures = 0,
          updated_at = now()
    `;

    await transaction`
      insert into public.audit_events (
        organization_id,
        actor_user_id,
        event_type,
        target_type,
        target_id,
        metadata
      ) values (
        ${input.organizationId},
        ${input.userId},
        'gmail.connected',
        'gmail_connection',
        ${connectionId},
        ${transaction.json({ scope: "gmail.readonly" })}
      )
    `;
    return connectionId;
  });
}

export async function organizationConnection(
  organizationId: string,
): Promise<GmailConnectionRow | null> {
  const rows = await database()<GmailConnectionRow[]>`
    select id, organization_id, inbox_email, status, last_successful_sync_at
    from public.gmail_connections
    where organization_id = ${organizationId}
    limit 1
  `;
  return rows[0] ?? null;
}

export async function connectedMailboxesByEmail(
  email: string,
): Promise<GmailConnectionRow[]> {
  return await database()<GmailConnectionRow[]>`
    select id, organization_id, inbox_email, status, last_successful_sync_at
    from public.gmail_connections
    where inbox_email = ${email.toLowerCase()}
      and status <> 'disconnected'
  `;
}

export async function disconnectMailbox(input: {
  connectionId: string;
  organizationId: string;
  userId: string;
  revocationOutcome: string;
}): Promise<void> {
  await database().begin(async (transaction) => {
    await transaction`
      delete from private.gmail_oauth_tokens
      where connection_id = ${input.connectionId}
    `;
    await transaction`
      update public.gmail_connections
      set status = 'disconnected',
          disconnected_at = now(),
          last_error_code = null
      where id = ${input.connectionId}
        and organization_id = ${input.organizationId}
    `;
    await transaction`
      insert into public.audit_events (
        organization_id,
        actor_user_id,
        event_type,
        target_type,
        target_id,
        metadata
      ) values (
        ${input.organizationId},
        ${input.userId},
        'gmail.disconnected',
        'gmail_connection',
        ${input.connectionId},
        ${transaction.json({ provider_revocation: input.revocationOutcome })}
      )
    `;
  });
}
