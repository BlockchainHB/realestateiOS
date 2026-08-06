import { database } from "./database.ts";
import { getNormalizedEmail } from "./gmail-message.ts";
import { HttpError } from "./http.ts";
import {
  gmailApi,
  type GoogleTokenBundle,
  refreshGoogleToken,
  startGmailWatch,
} from "./oauth.ts";
import { ingestEmailSourceEvent } from "./source-events.ts";
import { loadToken, saveToken } from "./token-store.ts";

interface HistoryResponse {
  history?: Array<{
    id?: string;
    messagesAdded?: Array<{ message?: { id?: string } }>;
  }>;
  historyId?: string;
  nextPageToken?: string;
}

function maxHistoryId(
  ...values: Array<string | null | undefined>
): string | null {
  const present = values.filter((value): value is string => Boolean(value));
  if (present.length === 0) return null;
  return present.reduce((maximum, value) =>
    BigInt(value) > BigInt(maximum) ? value : maximum
  );
}

export async function freshConnectionToken(
  connectionId: string,
): Promise<GoogleTokenBundle> {
  const bundle = await loadToken(connectionId);
  if (!bundle) {
    throw new HttpError(
      409,
      "gmail_not_connected",
      "The organization has no usable Gmail authorization.",
    );
  }
  if (Date.parse(bundle.expiresAt) > Date.now() + 120_000) return bundle;
  try {
    const refreshed = await refreshGoogleToken(bundle);
    await saveToken(connectionId, refreshed);
    return refreshed;
  } catch (error) {
    await database()`
      update public.gmail_connections
      set status = 'needs_reauthorization',
          needs_reauthorization_at = now(),
          last_error_code = 'token_refresh_failed'
      where id = ${connectionId}
    `;
    throw error;
  }
}

export async function synchronizeConnection(
  connectionId: string,
  notifiedHistoryId?: string,
): Promise<{ processed: number; cursor: string | null }> {
  const sql = database();
  const rows = await sql<{
    organization_id: string;
    last_history_id: string | null;
    status: string;
  }[]>`
    select connection.organization_id, state.last_history_id, connection.status
    from public.gmail_connections connection
    join public.gmail_sync_states state on state.connection_id = connection.id
    where connection.id = ${connectionId}
      and connection.status <> 'disconnected'
  `;
  const connection = rows[0];
  if (!connection) {
    throw new HttpError(
      404,
      "gmail_connection_not_found",
      "The Gmail connection was not found.",
    );
  }
  const bundle = await freshConnectionToken(connectionId);
  if (!connection.last_history_id) {
    return { processed: 0, cursor: notifiedHistoryId ?? null };
  }

  await sql`
    update public.gmail_sync_states
    set status = 'running'
    where connection_id = ${connectionId}
  `;
  try {
    let pageToken: string | undefined;
    let cursor = maxHistoryId(connection.last_history_id, notifiedHistoryId);
    const messageIds = new Set<string>();
    do {
      const params = new URLSearchParams({
        startHistoryId: connection.last_history_id,
        historyTypes: "messageAdded",
        maxResults: "100",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const history = await gmailApi<HistoryResponse>(
        bundle,
        `/history?${params.toString()}`,
      );
      cursor = maxHistoryId(
        cursor,
        history.historyId,
        ...(history.history ?? []).map((entry) => entry.id),
      );
      for (const entry of history.history ?? []) {
        for (const added of entry.messagesAdded ?? []) {
          if (added.message?.id) messageIds.add(added.message.id);
        }
      }
      pageToken = history.nextPageToken;
    } while (pageToken);

    let processed = 0;
    for (const messageId of messageIds) {
      const email = await getNormalizedEmail(bundle, messageId);
      const outcome = await ingestEmailSourceEvent({
        connectionId,
        organizationId: connection.organization_id,
        email,
      });
      if (outcome === "created") processed += 1;
    }

    await sql`
      update public.gmail_sync_states
      set last_history_id = case
            when ${cursor}::text is null then last_history_id
            when last_history_id is null then ${cursor}
            when ${cursor}::numeric > last_history_id::numeric then ${cursor}
            else last_history_id
          end,
          status = 'idle',
          consecutive_failures = 0,
          updated_at = now()
      where connection_id = ${connectionId}
    `;
    await sql`
      update public.gmail_connections
      set status = 'connected',
          last_successful_sync_at = now(),
          last_error_code = null
      where id = ${connectionId}
    `;
    return { processed, cursor };
  } catch (error) {
    await sql`
      update public.gmail_sync_states
      set status = 'failed',
          consecutive_failures = consecutive_failures + 1,
          updated_at = now()
      where connection_id = ${connectionId}
    `;
    await sql`
      update public.gmail_connections
      set status = case when status = 'needs_reauthorization' then status else 'sync_delayed' end,
          last_error_code = ${
      error instanceof HttpError ? error.code : "sync_failed"
    }
      where id = ${connectionId}
    `;
    throw error;
  }
}

export async function renewConnectionWatch(
  connectionId: string,
): Promise<void> {
  const bundle = await freshConnectionToken(connectionId);
  const watch = await startGmailWatch(bundle);
  await database()`
    update public.gmail_sync_states
    set last_history_id = coalesce(last_history_id, ${watch.historyId}),
        watch_expiration = to_timestamp(${watch.expiration}::numeric / 1000),
        status = 'idle',
        consecutive_failures = 0,
        updated_at = now()
    where connection_id = ${connectionId}
  `;
  await synchronizeConnection(connectionId, watch.historyId);
}
