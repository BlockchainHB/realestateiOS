import { decryptJson, encryptJson } from "./crypto.ts";
import { database } from "./database.ts";
import { HttpError } from "./http.ts";
import type { GoogleTokenBundle } from "./oauth.ts";

export interface GmailConnectionRow {
  id: string;
  organization_id: string;
  provider_account_id: string;
  inbox_email: string;
  status:
    | "connected"
    | "needs_reauthorization"
    | "sync_delayed"
    | "disconnected";
  last_successful_sync_at: string | null;
}

export function preservedHistoryCursor(
  existingCursor: string | null | undefined,
  watchCursor: string,
): string {
  return existingCursor ?? watchCursor;
}

export async function requireCompatibleMailbox(
  organizationId: string,
  providerAccountId: string,
): Promise<void> {
  const existing = await organizationConnection(organizationId);
  if (
    existing &&
    existing.provider_account_id !== providerAccountId.toLowerCase()
  ) {
    throw new HttpError(
      409,
      "gmail_mailbox_replacement_not_allowed",
      "Disconnecting does not replace the mailbox identity retained by payment source records.",
    );
  }
}

export async function connectMailbox(input: {
  organizationId: string;
  userId: string;
  providerAccountId: string;
  inboxEmail: string;
  bundle: GoogleTokenBundle;
  intentStateHash: string;
  startWatch: () => Promise<{ historyId: string; expiration: string }>;
}, sql = database()): Promise<{
  connectionId: string;
  watch: { historyId: string; expiration: string };
}> {
  const tokenCiphertext = await encryptJson(input.bundle);
  const providerAccountId = input.providerAccountId.toLowerCase();
  const inboxEmail = input.inboxEmail.toLowerCase();
  return await sql.begin(async (transaction) => {
    await transaction`
      select pg_advisory_xact_lock(
        hashtextextended(${"gmail-org:" + input.organizationId}, 0)
      )
    `;
    const connectionIntents = await transaction<{ organization_id: string }[]>`
      select organization_id
      from private.gmail_connection_intents
      where organization_id = ${input.organizationId}
        and state_hash = ${input.intentStateHash}
        and requested_by = ${input.userId}
        and expires_at > now()
    `;
    if (!connectionIntents[0]) {
      throw new HttpError(
        409,
        "gmail_connection_cancelled",
        "This Gmail connection attempt was cancelled or replaced.",
      );
    }
    const providerLocks = await transaction<{ acquired: boolean }[]>`
      select pg_try_advisory_xact_lock(
        hashtextextended(${providerAccountId}, 0)
      ) as acquired
    `;
    if (!providerLocks[0]?.acquired) {
      throw new HttpError(
        409,
        "gmail_provider_operation_in_progress",
        "Another connection attempt for this Gmail account is still finishing.",
      );
    }
    const pendingRevocations = await transaction<{ connection_id: string }[]>`
      select revocation.connection_id
      from private.gmail_token_revocations revocation
      join public.gmail_connections connection
        on connection.id = revocation.connection_id
      where connection.provider_account_id = ${providerAccountId}
      limit 1
    `;
    if (pendingRevocations[0]) {
      throw new HttpError(
        409,
        "gmail_revocation_pending",
        "Retry the previous Google disconnect before reconnecting this mailbox.",
      );
    }
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

    const existingConnections = await transaction<{
      provider_account_id: string;
      last_history_id: string | null;
      last_history_snapshot_at: string | null;
      revocation_pending: boolean;
    }[]>`
      select connection.provider_account_id,
             state.last_history_id,
             state.last_history_snapshot_at,
             revocation.connection_id is not null as revocation_pending
      from public.gmail_connections connection
      left join public.gmail_sync_states state
        on state.connection_id = connection.id
      left join private.gmail_token_revocations revocation
        on revocation.connection_id = connection.id
      where connection.organization_id = ${input.organizationId}
      for update of connection
    `;
    if (existingConnections[0]?.revocation_pending) {
      throw new HttpError(
        409,
        "gmail_revocation_pending",
        "Retry the previous Google disconnect before reconnecting this mailbox.",
      );
    }
    if (
      existingConnections[0] &&
      existingConnections[0].provider_account_id !== providerAccountId
    ) {
      throw new HttpError(
        409,
        "gmail_mailbox_replacement_not_allowed",
        "Disconnecting does not replace the mailbox identity retained by payment source records.",
      );
    }
    const watchSnapshotStartedAt = new Date().toISOString();
    const watch = await input.startWatch();
    const historyCursor = preservedHistoryCursor(
      existingConnections[0]?.last_history_id,
      watch.historyId,
    );
    const historySnapshotAt = existingConnections[0]?.last_history_id
      ? existingConnections[0].last_history_snapshot_at
      : watchSnapshotStartedAt;

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
        ${providerAccountId},
        ${inboxEmail},
        'connected',
        ${input.userId},
        now(),
        null,
        null,
        null
      )
      on conflict (organization_id) do update
      set status = 'connected',
          connected_by = excluded.connected_by,
          connected_at = now(),
          disconnected_at = null,
          needs_reauthorization_at = null,
          last_error_code = null
      where public.gmail_connections.provider_account_id = excluded.provider_account_id
      returning id
    `;
    const connectionId = connections[0]?.id;
    if (!connectionId) {
      throw new HttpError(
        409,
        "gmail_mailbox_replacement_not_allowed",
        "Disconnecting does not replace the mailbox identity retained by payment source records.",
      );
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
          authorization_generation =
            private.gmail_oauth_tokens.authorization_generation + 1,
          updated_at = now()
    `;

    await transaction`
      insert into public.gmail_sync_states (
        connection_id,
        organization_id,
        last_history_id,
        last_history_snapshot_at,
        watch_expiration,
        status,
        consecutive_failures
      ) values (
        ${connectionId},
        ${input.organizationId},
        ${historyCursor},
        ${historySnapshotAt},
        to_timestamp(${watch.expiration}::numeric / 1000),
        'idle',
        0
      )
      on conflict (connection_id) do update
      set organization_id = excluded.organization_id,
          last_history_id = coalesce(
            public.gmail_sync_states.last_history_id,
            excluded.last_history_id
          ),
          last_history_snapshot_at = case
            when public.gmail_sync_states.last_history_id is null
              then excluded.last_history_snapshot_at
            else public.gmail_sync_states.last_history_snapshot_at
          end,
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
    await transaction`
      delete from private.gmail_connection_intents
      where organization_id = ${input.organizationId}
        and state_hash = ${input.intentStateHash}
    `;
    return { connectionId, watch };
  });
}

export async function organizationConnection(
  organizationId: string,
): Promise<GmailConnectionRow | null> {
  const rows = await database()<GmailConnectionRow[]>`
    select id, organization_id, provider_account_id, inbox_email, status,
           last_successful_sync_at
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
    select id, organization_id, provider_account_id, inbox_email, status,
           last_successful_sync_at
    from public.gmail_connections
    where inbox_email = ${email.toLowerCase()}
      and status <> 'disconnected'
  `;
}

export async function cleanupProviderAccessIfUnused<T>(
  providerAccountId: string,
  cleanup: () => Promise<T>,
  sql = database(),
): Promise<{ attempted: boolean; result: T | null }> {
  return await sql.begin(async (transaction) => {
    const normalizedProviderAccountId = providerAccountId.toLowerCase();
    await transaction`
      select pg_advisory_xact_lock(
        hashtextextended(${normalizedProviderAccountId}, 0)
      )
    `;
    const activeConnections = await transaction<{ id: string }[]>`
      select id
      from public.gmail_connections
      where provider_account_id = ${normalizedProviderAccountId}
        and status <> 'disconnected'
      limit 1
    `;
    if (activeConnections[0]) return { attempted: false, result: null };
    return { attempted: true, result: await cleanup() };
  });
}

export async function disconnectMailbox(input: {
  organizationId: string;
  userId: string;
}, sql = database()): Promise<{
  connectionId: string | null;
  providerCleanupRequired: boolean;
  bundle: GoogleTokenBundle | null;
}> {
  return await sql.begin(async (transaction) => {
    await transaction`
      select pg_advisory_xact_lock(
        hashtextextended(${"gmail-org:" + input.organizationId}, 0)
      )
    `;
    await transaction`
      delete from private.gmail_connection_intents
      where organization_id = ${input.organizationId}
    `;
    await transaction`
      delete from private.gmail_oauth_authorization_states
      where organization_id = ${input.organizationId}
    `;
    const targets = await transaction<{
      id: string;
      provider_account_id: string;
    }[]>`
      select id, provider_account_id
      from public.gmail_connections
      where organization_id = ${input.organizationId}
    `;
    const connectionId = targets[0]?.id;
    const providerAccountId = targets[0]?.provider_account_id;
    if (!connectionId || !providerAccountId) {
      return {
        connectionId: null,
        providerCleanupRequired: false,
        bundle: null,
      };
    }
    await transaction`
      select pg_advisory_xact_lock(hashtextextended(${providerAccountId}, 0))
    `;
    const connections = await transaction<{ id: string; status: string }[]>`
      select id, status
      from public.gmail_connections
      where provider_account_id = ${providerAccountId}
      for update
    `;
    const tokenRows = await transaction<{ token_ciphertext: string }[]>`
      select token_ciphertext
      from private.gmail_oauth_tokens
      where connection_id = ${connectionId}
    `;
    const pendingRevocations = await transaction<{ connection_id: string }[]>`
      select connection_id
      from private.gmail_token_revocations
      where connection_id = ${connectionId}
    `;
    const bundle = tokenRows[0]
      ? await decryptJson<GoogleTokenBundle>(tokenRows[0].token_ciphertext)
      : null;
    const refreshTokenCiphertext = bundle?.refreshToken
      ? await encryptJson({ refreshToken: bundle.refreshToken })
      : null;
    const otherActiveConnection = connections.some((connection) =>
      connection.id !== connectionId &&
      connection.status !== "disconnected"
    );
    const providerCleanupRequired = !otherActiveConnection && Boolean(
      refreshTokenCiphertext || pendingRevocations[0],
    );
    if (refreshTokenCiphertext && !otherActiveConnection) {
      await transaction`
        insert into private.gmail_token_revocations (
          connection_id,
          refresh_token_ciphertext
        ) values (
          ${connectionId},
          ${refreshTokenCiphertext}
        )
        on conflict (connection_id) do update
        set refresh_token_ciphertext = excluded.refresh_token_ciphertext,
            updated_at = now()
      `;
    }
    await transaction`
      delete from private.gmail_oauth_tokens
      where connection_id = ${connectionId}
    `;
    await transaction`
      update public.gmail_connections
      set status = 'disconnected',
          disconnected_at = now(),
          last_error_code = null
      where id = ${connectionId}
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
        ${connectionId},
        ${
      transaction.json({
        provider_revocation: providerCleanupRequired
          ? "pending"
          : otherActiveConnection
          ? "shared_mailbox_retained"
          : "token_missing",
      })
    }
      )
    `;
    return { connectionId, providerCleanupRequired, bundle };
  });
}

export async function pendingRevocationToken(
  connectionId: string,
): Promise<string | null> {
  const rows = await database()<{
    refresh_token_ciphertext: string;
  }[]>`
    update private.gmail_token_revocations
    set last_attempt_at = now(),
        updated_at = now()
    where connection_id = ${connectionId}
    returning refresh_token_ciphertext
  `;
  if (!rows[0]) return null;
  const decrypted = await decryptJson<{ refreshToken: string }>(
    rows[0].refresh_token_ciphertext,
  );
  return decrypted.refreshToken;
}

export async function completeRevocationCleanup(input: {
  connectionId: string;
  organizationId: string;
  userId: string;
}): Promise<void> {
  await database().begin(async (transaction) => {
    const deleted = await transaction<{ connection_id: string }[]>`
      delete from private.gmail_token_revocations
      where connection_id = ${input.connectionId}
      returning connection_id
    `;
    if (!deleted[0]) return;
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
        'gmail.provider_access_revoked',
        'gmail_connection',
        ${input.connectionId},
        ${transaction.json({ provider_revocation: "revoked" })}
      )
    `;
  });
}
