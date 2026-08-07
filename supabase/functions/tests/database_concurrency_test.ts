import { assertEquals, assertMatch } from "jsr:@std/assert@1.0.14";
import postgres, { type Sql } from "npm:postgres@3.4.9";
import {
  cleanupProviderAccessIfUnused,
  connectMailbox,
  disconnectMailbox,
} from "../_shared/connections.ts";
import { HttpError } from "../_shared/http.ts";
import { claimNotificationReceipt } from "../_shared/notification-receipts.ts";
import { saveToken } from "../_shared/token-store.ts";
import { renewConnectionWatch } from "../_shared/sync.ts";

const databaseUrl = Deno.env.get("SUPABASE_DB_URL");
if (!databaseUrl) throw new Error("SUPABASE_DB_URL is required");

async function registerConnectionIntent(
  sql: Sql,
  organizationId: string,
  userId: string,
  stateHash: string,
): Promise<void> {
  await sql`
    insert into private.gmail_connection_intents (
      organization_id, state_hash, requested_by, expires_at
    ) values (
      ${organizationId}, ${stateHash}, ${userId}, now() + interval '10 minutes'
    )
    on conflict (organization_id) do update
    set state_hash = excluded.state_hash,
        requested_by = excluded.requested_by,
        expires_at = excluded.expires_at,
        created_at = now()
  `;
}

Deno.test("concurrent owner revocations retain one active owner", async () => {
  const sql = postgres(databaseUrl, { max: 3 });
  const secondUserId = "f0000000-0000-0000-0000-000000000002";
  const secondMembershipId = "f2000000-0000-0000-0000-000000000002";
  const firstMembershipId = "f2000000-0000-0000-0000-000000000001";
  const organizationId = "f1000000-0000-0000-0000-000000000001";

  try {
    await sql`
      update public.organization_memberships
      set revoked_at = null
      where id = ${firstMembershipId}
    `;
    await sql`
      delete from public.organization_memberships
      where id = ${secondMembershipId}
    `;
    await sql`delete from auth.users where id = ${secondUserId}`;
    await sql`
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at, confirmation_token, email_change,
        email_change_token_new, recovery_token
      ) values (
        '00000000-0000-0000-0000-000000000000',
        ${secondUserId},
        'authenticated',
        'authenticated',
        'concurrent-owner@example.test',
        '',
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{}'::jsonb,
        now(),
        now(),
        '',
        '',
        '',
        ''
      )
    `;
    await sql`
      insert into public.organization_memberships (
        id, organization_id, user_id, role, created_by
      ) values (
        ${secondMembershipId},
        ${organizationId},
        ${secondUserId},
        'owner',
        'f0000000-0000-0000-0000-000000000001'
      )
    `;

    let releaseFirst!: () => void;
    const holdFirst = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstUpdated!: () => void;
    const firstHasLock = new Promise<void>((resolve) => {
      firstUpdated = resolve;
    });

    const firstRemoval = sql.begin(async (transaction) => {
      await transaction`
        update public.organization_memberships
        set revoked_at = now()
        where id = ${firstMembershipId}
      `;
      firstUpdated();
      await holdFirst;
    });
    await firstHasLock;

    let secondSettled = false;
    const secondRemoval = sql.begin(async (transaction) => {
      await transaction`
        update public.organization_memberships
        set revoked_at = now()
        where id = ${secondMembershipId}
      `;
    }).then(
      () => ({ error: null }),
      (error: unknown) => ({ error }),
    ).finally(() => {
      secondSettled = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    assertEquals(secondSettled, false);
    releaseFirst();
    await firstRemoval;
    const secondResult = await secondRemoval;
    assertMatch(
      secondResult.error instanceof Error ? secondResult.error.message : "",
      /retain at least one active owner/u,
    );
    const activeOwners = await sql<{ count: number }[]>`
      select count(*)::integer as count
      from public.organization_memberships
      where organization_id = ${organizationId}
        and role = 'owner'
        and revoked_at is null
    `;
    assertEquals(activeOwners[0]?.count, 1);
  } finally {
    await sql`
      update public.organization_memberships
      set revoked_at = null
      where id = ${firstMembershipId}
    `.catch(() => undefined);
    await sql`
      delete from public.organization_memberships
      where id = ${secondMembershipId}
    `.catch(() => undefined);
    await sql`delete from auth.users where id = ${secondUserId}`.catch(
      () => undefined,
    );
    await sql.end();
  }
});

Deno.test("disconnect wins against in-flight refreshed token persistence", async () => {
  const sql = postgres(databaseUrl, { max: 3 });
  const connectionId = "f8000000-0000-0000-0000-000000000001";
  const organizationId = "f1000000-0000-0000-0000-000000000001";
  const userId = "f0000000-0000-0000-0000-000000000001";
  Deno.env.set(
    "GMAIL_TOKEN_ENCRYPTION_KEY",
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  );

  try {
    await sql`
      insert into public.gmail_connections (
        id, organization_id, provider_account_id, inbox_email, connected_by
      ) values (
        ${connectionId}, ${organizationId}, 'race@example.test',
        'race@example.test', ${userId}
      )
      on conflict (organization_id) do update
      set status = 'connected', disconnected_at = null
    `;

    let releaseDisconnect!: () => void;
    const holdDisconnect = new Promise<void>((resolve) => {
      releaseDisconnect = resolve;
    });
    let disconnectedInTransaction!: () => void;
    const disconnectHasLock = new Promise<void>((resolve) => {
      disconnectedInTransaction = resolve;
    });

    const disconnect = sql.begin(async (transaction) => {
      await transaction`
        select id
        from public.gmail_connections
        where id = ${connectionId}
        for update
      `;
      await transaction`
        delete from private.gmail_oauth_tokens
        where connection_id = ${connectionId}
      `;
      await transaction`
        update public.gmail_connections
        set status = 'disconnected', disconnected_at = now()
        where id = ${connectionId}
      `;
      disconnectedInTransaction();
      await holdDisconnect;
    });
    await disconnectHasLock;

    let persistenceSettled = false;
    const persistence = saveToken(connectionId, {
      accessToken: "synthetic-refreshed-access",
      refreshToken: "synthetic-refresh",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    }, sql).then((saved) => {
      persistenceSettled = true;
      return saved;
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    assertEquals(persistenceSettled, false);
    releaseDisconnect();
    await disconnect;
    assertEquals(await persistence, false);
    const tokens = await sql<{ count: number }[]>`
      select count(*)::integer as count
      from private.gmail_oauth_tokens
      where connection_id = ${connectionId}
    `;
    assertEquals(tokens[0]?.count, 0);
  } finally {
    await sql`
      delete from private.gmail_oauth_tokens where connection_id = ${connectionId}
    `.catch(() => undefined);
    await sql`
      delete from public.gmail_connections where id = ${connectionId}
    `.catch(() => undefined);
    await sql.end();
  }
});

Deno.test("abandoned Pub/Sub processing receipts are reclaimed once", async () => {
  const sql = postgres(databaseUrl, { max: 2 });
  const messageId = "synthetic-concurrency-stale-receipt";
  try {
    await sql`
      insert into private.gmail_notification_receipts (
        pubsub_message_id, notified_history_id, received_at, outcome
      ) values (
        ${messageId}, '501', now() - interval '6 minutes', 'processing'
      )
      on conflict (pubsub_message_id) do update
      set notified_history_id = excluded.notified_history_id,
          received_at = excluded.received_at,
          outcome = excluded.outcome
    `;
    assertEquals(await claimNotificationReceipt(messageId, "502", sql), true);
    assertEquals(await claimNotificationReceipt(messageId, "503", sql), false);
    const receipts = await sql<{ notified_history_id: string }[]>`
      select notified_history_id
      from private.gmail_notification_receipts
      where pubsub_message_id = ${messageId}
    `;
    assertEquals(receipts[0]?.notified_history_id, "502");
  } finally {
    await sql`
      delete from private.gmail_notification_receipts
      where pubsub_message_id = ${messageId}
    `.catch(() => undefined);
    await sql.end();
  }
});

Deno.test("shared mailbox provider cleanup waits for the final organization", async () => {
  const sql = postgres(databaseUrl, { max: 2 });
  const ownerId = "f0000000-0000-0000-0000-000000000001";
  const firstOrganizationId = "f1000000-0000-0000-0000-000000000001";
  const secondOrganizationId = "f1000000-0000-0000-0000-000000000002";
  const firstConnectionId = "f8000000-0000-0000-0000-000000000011";
  const secondConnectionId = "f8000000-0000-0000-0000-000000000012";
  const providerAccountId = "shared-race@example.test";
  Deno.env.set(
    "GMAIL_TOKEN_ENCRYPTION_KEY",
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  );

  try {
    await sql`
      insert into public.organizations (id, name, created_by)
      values (${secondOrganizationId}, 'Synthetic Shared Mailbox', ${ownerId})
      on conflict (id) do nothing
    `;
    await sql`
      delete from private.gmail_token_revocations
      where connection_id in (${firstConnectionId}, ${secondConnectionId})
    `;
    await sql`
      delete from public.gmail_connections
      where id in (${firstConnectionId}, ${secondConnectionId})
    `;
    await sql`
      insert into public.gmail_connections (
        id, organization_id, provider_account_id, inbox_email, connected_by
      ) values
        (${firstConnectionId}, ${firstOrganizationId}, ${providerAccountId}, ${providerAccountId}, ${ownerId}),
        (${secondConnectionId}, ${secondOrganizationId}, ${providerAccountId}, ${providerAccountId}, ${ownerId})
    `;
    assertEquals(
      await saveToken(firstConnectionId, {
        accessToken: "synthetic-first-access",
        refreshToken: "synthetic-first-refresh",
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      }, sql),
      true,
    );
    assertEquals(
      await saveToken(secondConnectionId, {
        accessToken: "synthetic-second-access",
        refreshToken: "synthetic-final-refresh",
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      }, sql),
      true,
    );

    let failedCallbackCleanupCalls = 0;
    const failedCallbackCleanup = await cleanupProviderAccessIfUnused(
      providerAccountId,
      () => {
        failedCallbackCleanupCalls += 1;
        return Promise.resolve("cleaned");
      },
      sql,
    );
    assertEquals(failedCallbackCleanup, { attempted: false, result: null });
    assertEquals(failedCallbackCleanupCalls, 0);

    const firstDisconnect = await disconnectMailbox({
      organizationId: firstOrganizationId,
      userId: ownerId,
    }, sql);
    assertEquals(firstDisconnect.providerCleanupRequired, false);

    const secondDisconnect = await disconnectMailbox({
      organizationId: secondOrganizationId,
      userId: ownerId,
    }, sql);
    assertEquals(secondDisconnect.providerCleanupRequired, true);
    const pending = await sql<{ connection_id: string }[]>`
      select connection_id
      from private.gmail_token_revocations
      where connection_id in (${firstConnectionId}, ${secondConnectionId})
    `;
    assertEquals(pending.length, 1);
    assertEquals(pending[0]?.connection_id, secondConnectionId);
  } finally {
    await sql`
      delete from private.gmail_token_revocations
      where connection_id in (${firstConnectionId}, ${secondConnectionId})
    `.catch(() => undefined);
    await sql`
      delete from public.gmail_connections
      where id in (${firstConnectionId}, ${secondConnectionId})
    `.catch(() => undefined);
    await sql.end();
  }
});

Deno.test("overlapping provider setup is rejected before a watch can start", async () => {
  const sql = postgres(databaseUrl, { max: 3 });
  const ownerId = "f0000000-0000-0000-0000-000000000001";
  const organizationId = "f1000000-0000-0000-0000-000000000001";
  const providerAccountId = "overlap@example.test";
  Deno.env.set(
    "GMAIL_TOKEN_ENCRYPTION_KEY",
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  );

  let firstConnectionId: string | null = null;
  let releaseFirstWatch: (() => void) | undefined;
  let firstSetup: ReturnType<typeof connectMailbox> | undefined;
  try {
    await sql`
      delete from private.gmail_oauth_tokens
      where connection_id in (
        select id from public.gmail_connections
        where organization_id = ${organizationId}
      )
    `;
    await sql`
      delete from private.gmail_token_revocations
      where connection_id in (
        select id from public.gmail_connections
        where organization_id = ${organizationId}
      )
    `;
    await sql`
      delete from public.gmail_sync_states
      where organization_id = ${organizationId}
    `;
    await sql`
      delete from public.gmail_connections
      where organization_id = ${organizationId}
    `;

    const holdFirstWatch = new Promise<void>((resolve) => {
      releaseFirstWatch = resolve;
    });
    let firstWatchStarted!: () => void;
    const firstHasProviderLock = new Promise<void>((resolve) => {
      firstWatchStarted = resolve;
    });
    let firstWatchCalls = 0;
    const intentStateHash = "8".repeat(64);
    await registerConnectionIntent(
      sql,
      organizationId,
      ownerId,
      intentStateHash,
    );
    firstSetup = connectMailbox({
      organizationId,
      userId: ownerId,
      providerAccountId,
      inboxEmail: providerAccountId,
      bundle: {
        accessToken: "synthetic-first-access",
        refreshToken: "synthetic-first-refresh",
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      },
      intentStateHash,
      startWatch: async () => {
        firstWatchCalls += 1;
        firstWatchStarted();
        await holdFirstWatch;
        return { historyId: "801", expiration: "1893456000000" };
      },
    }, sql);
    await firstHasProviderLock;

    let secondWatchCalls = 0;
    const secondSetupPromise = connectMailbox({
      organizationId,
      userId: ownerId,
      providerAccountId,
      inboxEmail: providerAccountId,
      bundle: {
        accessToken: "synthetic-second-access",
        refreshToken: "synthetic-second-refresh",
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      },
      intentStateHash,
      startWatch: () => {
        secondWatchCalls += 1;
        return Promise.resolve({
          historyId: "802",
          expiration: "1893456000000",
        });
      },
    }, sql).then(
      () => ({ error: null }),
      (error: unknown) => ({ error }),
    );
    releaseFirstWatch?.();
    const firstResult = await firstSetup;
    firstConnectionId = firstResult.connectionId;
    assertEquals(firstWatchCalls, 1);
    assertEquals(firstResult.watch.historyId, "801");

    const secondSetup = await secondSetupPromise;
    assertEquals(secondSetup.error instanceof HttpError, true);
    assertEquals(
      secondSetup.error instanceof HttpError ? secondSetup.error.code : null,
      "gmail_connection_cancelled",
    );
    assertEquals(secondWatchCalls, 0);
  } finally {
    releaseFirstWatch?.();
    const unfinishedResult = await firstSetup?.catch(() => null);
    firstConnectionId ??= unfinishedResult?.connectionId ?? null;
    if (firstConnectionId) {
      await sql`
        delete from private.gmail_oauth_tokens
        where connection_id = ${firstConnectionId}
      `.catch(() => undefined);
      await sql`
        delete from public.gmail_sync_states
        where connection_id = ${firstConnectionId}
      `.catch(() => undefined);
      await sql`
        delete from public.gmail_connections
        where id = ${firstConnectionId}
      `.catch(() => undefined);
    }
    await sql.end();
  }
});

Deno.test("watch renewal serializes with final mailbox disconnect", async () => {
  const sql = postgres(databaseUrl, { max: 3 });
  const connectionId = "f8000000-0000-0000-0000-000000000021";
  const organizationId = "f1000000-0000-0000-0000-000000000001";
  const ownerId = "f0000000-0000-0000-0000-000000000001";
  const providerAccountId = "renewal-race@example.test";
  Deno.env.set(
    "GMAIL_TOKEN_ENCRYPTION_KEY",
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  );

  let releaseWatch: (() => void) | undefined;
  let renewal: ReturnType<typeof renewConnectionWatch> | undefined;
  let disconnect: ReturnType<typeof disconnectMailbox> | undefined;
  try {
    await sql`
      delete from private.gmail_oauth_tokens
      where connection_id in (
        select id from public.gmail_connections
        where organization_id = ${organizationId}
      )
    `;
    await sql`
      delete from private.gmail_token_revocations
      where connection_id in (
        select id from public.gmail_connections
        where organization_id = ${organizationId}
      )
    `;
    await sql`
      delete from public.gmail_sync_states
      where organization_id = ${organizationId}
    `;
    await sql`
      delete from public.gmail_connections
      where organization_id = ${organizationId}
    `;
    await sql`
      insert into public.gmail_connections (
        id, organization_id, provider_account_id, inbox_email, connected_by
      ) values (
        ${connectionId}, ${organizationId}, ${providerAccountId},
        ${providerAccountId}, ${ownerId}
      )
    `;
    await sql`
      insert into public.gmail_sync_states (
        connection_id, organization_id, last_history_id, watch_expiration
      ) values (
        ${connectionId}, ${organizationId}, '901', now() + interval '1 day'
      )
    `;
    assertEquals(
      await saveToken(connectionId, {
        accessToken: "synthetic-renewal-access",
        refreshToken: "synthetic-renewal-refresh",
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      }, sql),
      true,
    );

    const holdWatch = new Promise<void>((resolve) => {
      releaseWatch = resolve;
    });
    let watchStarted!: () => void;
    const renewalHasProviderLock = new Promise<void>((resolve) => {
      watchStarted = resolve;
    });
    let watchCalls = 0;
    renewal = renewConnectionWatch(connectionId, {
      sql,
      startWatch: async () => {
        watchCalls += 1;
        watchStarted();
        await holdWatch;
        return { historyId: "902", expiration: "1893456000000" };
      },
      synchronize: (_connectionId, notifiedHistoryId) =>
        Promise.resolve({ processed: 0, cursor: notifiedHistoryId ?? null }),
    });
    await renewalHasProviderLock;

    let disconnectSettled = false;
    disconnect = disconnectMailbox({
      organizationId,
      userId: ownerId,
    }, sql).finally(() => {
      disconnectSettled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assertEquals(disconnectSettled, false);

    releaseWatch?.();
    await renewal;
    await disconnect;
    assertEquals(watchCalls, 1);
    const connections = await sql<{ status: string }[]>`
      select status
      from public.gmail_connections
      where id = ${connectionId}
    `;
    assertEquals(connections[0]?.status, "disconnected");
    const retryAfterDisconnect = await renewConnectionWatch(connectionId, {
      sql,
      startWatch: async () => {
        watchCalls += 1;
        return { historyId: "903", expiration: "1893456000000" };
      },
      synchronize: (_connectionId, notifiedHistoryId) =>
        Promise.resolve({ processed: 0, cursor: notifiedHistoryId ?? null }),
    }).then(
      () => ({ error: null }),
      (error: unknown) => ({ error }),
    );
    assertEquals(retryAfterDisconnect.error instanceof HttpError, true);
    assertEquals(
      retryAfterDisconnect.error instanceof HttpError
        ? retryAfterDisconnect.error.code
        : null,
      "gmail_not_connected",
    );
    assertEquals(watchCalls, 1);
  } finally {
    releaseWatch?.();
    await renewal?.catch(() => undefined);
    await disconnect?.catch(() => undefined);
    await sql`
      delete from private.gmail_token_revocations
      where connection_id = ${connectionId}
    `.catch(() => undefined);
    await sql`
      delete from private.gmail_oauth_tokens
      where connection_id = ${connectionId}
    `.catch(() => undefined);
    await sql`
      delete from public.gmail_sync_states
      where connection_id = ${connectionId}
    `.catch(() => undefined);
    await sql`
      delete from public.gmail_connections
      where id = ${connectionId}
    `.catch(() => undefined);
    await sql.end();
  }
});

Deno.test("disconnect retains the reauthorized bundle under the provider lock", async () => {
  const sql = postgres(databaseUrl, { max: 3 });
  const connectionId = "f8000000-0000-0000-0000-000000000031";
  const organizationId = "f1000000-0000-0000-0000-000000000001";
  const ownerId = "f0000000-0000-0000-0000-000000000001";
  const providerAccountId = "reauthorization-race@example.test";
  Deno.env.set(
    "GMAIL_TOKEN_ENCRYPTION_KEY",
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  );

  let releaseWatch: (() => void) | undefined;
  let reauthorization: ReturnType<typeof connectMailbox> | undefined;
  let disconnect: ReturnType<typeof disconnectMailbox> | undefined;
  try {
    await sql`
      delete from private.gmail_oauth_tokens
      where connection_id in (
        select id from public.gmail_connections
        where organization_id = ${organizationId}
      )
    `;
    await sql`
      delete from private.gmail_token_revocations
      where connection_id in (
        select id from public.gmail_connections
        where organization_id = ${organizationId}
      )
    `;
    await sql`
      delete from public.gmail_sync_states
      where organization_id = ${organizationId}
    `;
    await sql`
      delete from public.gmail_connections
      where organization_id = ${organizationId}
    `;
    await sql`
      insert into public.gmail_connections (
        id, organization_id, provider_account_id, inbox_email, connected_by
      ) values (
        ${connectionId}, ${organizationId}, ${providerAccountId},
        ${providerAccountId}, ${ownerId}
      )
    `;
    await sql`
      insert into public.gmail_sync_states (
        connection_id, organization_id, last_history_id, watch_expiration
      ) values (
        ${connectionId}, ${organizationId}, '951', now() + interval '1 day'
      )
    `;
    assertEquals(
      await saveToken(connectionId, {
        accessToken: "synthetic-stale-access",
        refreshToken: "synthetic-stale-refresh",
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      }, sql),
      true,
    );

    const currentBundle = {
      accessToken: "synthetic-current-access",
      refreshToken: "synthetic-current-refresh",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    };
    const holdWatch = new Promise<void>((resolve) => {
      releaseWatch = resolve;
    });
    let watchStarted!: () => void;
    const reauthorizationHasProviderLock = new Promise<void>((resolve) => {
      watchStarted = resolve;
    });
    const intentStateHash = "9".repeat(64);
    await registerConnectionIntent(
      sql,
      organizationId,
      ownerId,
      intentStateHash,
    );
    reauthorization = connectMailbox({
      organizationId,
      userId: ownerId,
      providerAccountId,
      inboxEmail: providerAccountId,
      bundle: currentBundle,
      intentStateHash,
      startWatch: async () => {
        watchStarted();
        await holdWatch;
        return { historyId: "952", expiration: "1893456000000" };
      },
    }, sql);
    await reauthorizationHasProviderLock;

    let disconnectSettled = false;
    disconnect = disconnectMailbox({
      organizationId,
      userId: ownerId,
    }, sql).finally(() => {
      disconnectSettled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assertEquals(disconnectSettled, false);

    releaseWatch?.();
    await reauthorization;
    const disconnected = await disconnect;
    assertEquals(disconnected.providerCleanupRequired, true);
    assertEquals(disconnected.bundle, currentBundle);
    const pendingRevocations = await sql<{ count: number }[]>`
      select count(*)::integer as count
      from private.gmail_token_revocations
      where connection_id = ${connectionId}
    `;
    assertEquals(pendingRevocations[0]?.count, 1);
  } finally {
    releaseWatch?.();
    await reauthorization?.catch(() => undefined);
    await disconnect?.catch(() => undefined);
    await sql`
      delete from private.gmail_token_revocations
      where connection_id = ${connectionId}
    `.catch(() => undefined);
    await sql`
      delete from private.gmail_oauth_tokens
      where connection_id = ${connectionId}
    `.catch(() => undefined);
    await sql`
      delete from public.gmail_sync_states
      where connection_id = ${connectionId}
    `.catch(() => undefined);
    await sql`
      delete from public.gmail_connections
      where id = ${connectionId}
    `.catch(() => undefined);
    await sql.end();
  }
});

Deno.test("disconnect rechecks a stale disconnected snapshot under the provider lock", async () => {
  const sql = postgres(databaseUrl, { max: 3 });
  const connectionId = "f8000000-0000-0000-0000-000000000032";
  const organizationId = "f1000000-0000-0000-0000-000000000001";
  const ownerId = "f0000000-0000-0000-0000-000000000001";
  const providerAccountId = "stale-disconnect-snapshot@example.test";
  Deno.env.set(
    "GMAIL_TOKEN_ENCRYPTION_KEY",
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  );

  try {
    await sql`
      delete from private.gmail_oauth_tokens
      where connection_id in (
        select id from public.gmail_connections
        where organization_id = ${organizationId}
      )
    `;
    await sql`
      delete from private.gmail_token_revocations
      where connection_id in (
        select id from public.gmail_connections
        where organization_id = ${organizationId}
      )
    `;
    await sql`
      delete from public.gmail_sync_states
      where organization_id = ${organizationId}
    `;
    await sql`
      delete from public.gmail_connections
      where organization_id = ${organizationId}
    `;
    await sql`
      insert into public.gmail_connections (
        id, organization_id, provider_account_id, inbox_email, connected_by,
        status, disconnected_at
      ) values (
        ${connectionId}, ${organizationId}, ${providerAccountId},
        ${providerAccountId}, ${ownerId}, 'disconnected', now()
      )
    `;
    await sql`
      insert into public.gmail_sync_states (
        connection_id, organization_id, last_history_id, watch_expiration
      ) values (
        ${connectionId}, ${organizationId}, '971', now() + interval '1 day'
      )
    `;

    const staleSnapshot = await sql<{ status: string }[]>`
      select status
      from public.gmail_connections
      where id = ${connectionId}
    `;
    assertEquals(staleSnapshot[0]?.status, "disconnected");

    const currentBundle = {
      accessToken: "synthetic-current-access",
      refreshToken: "synthetic-current-refresh",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    };
    const intentStateHash = "a".repeat(64);
    await registerConnectionIntent(
      sql,
      organizationId,
      ownerId,
      intentStateHash,
    );
    await connectMailbox({
      organizationId,
      userId: ownerId,
      providerAccountId,
      inboxEmail: providerAccountId,
      bundle: currentBundle,
      intentStateHash,
      startWatch: () =>
        Promise.resolve({
          historyId: "972",
          expiration: "1893456000000",
        }),
    }, sql);

    const disconnected = await disconnectMailbox({
      organizationId,
      userId: ownerId,
    }, sql);
    assertEquals(disconnected.providerCleanupRequired, true);
    assertEquals(disconnected.bundle, currentBundle);
    const finalConnections = await sql<{ status: string }[]>`
      select status
      from public.gmail_connections
      where id = ${connectionId}
    `;
    assertEquals(finalConnections[0]?.status, "disconnected");
    const storedTokens = await sql<{ count: number }[]>`
      select count(*)::integer as count
      from private.gmail_oauth_tokens
      where connection_id = ${connectionId}
    `;
    assertEquals(storedTokens[0]?.count, 0);
  } finally {
    await sql`
      delete from private.gmail_token_revocations
      where connection_id = ${connectionId}
    `.catch(() => undefined);
    await sql`
      delete from private.gmail_oauth_tokens
      where connection_id = ${connectionId}
    `.catch(() => undefined);
    await sql`
      delete from public.gmail_sync_states
      where connection_id = ${connectionId}
    `.catch(() => undefined);
    await sql`
      delete from public.gmail_connections
      where id = ${connectionId}
    `.catch(() => undefined);
    await sql.end();
  }
});

Deno.test("disconnect cancels an OAuth callback before its connection row exists", async () => {
  const sql = postgres(databaseUrl, { max: 3 });
  const organizationId = "f1000000-0000-0000-0000-000000000001";
  const ownerId = "f0000000-0000-0000-0000-000000000001";
  const providerAccountId = "cancelled-before-connect@example.test";
  const intentStateHash = "b".repeat(64);
  Deno.env.set(
    "GMAIL_TOKEN_ENCRYPTION_KEY",
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  );

  try {
    await sql`
      delete from private.gmail_oauth_tokens
      where connection_id in (
        select id from public.gmail_connections
        where organization_id = ${organizationId}
      )
    `;
    await sql`
      delete from private.gmail_token_revocations
      where connection_id in (
        select id from public.gmail_connections
        where organization_id = ${organizationId}
      )
    `;
    await sql`
      delete from public.gmail_sync_states
      where organization_id = ${organizationId}
    `;
    await sql`
      delete from public.gmail_connections
      where organization_id = ${organizationId}
    `;
    await registerConnectionIntent(
      sql,
      organizationId,
      ownerId,
      intentStateHash,
    );

    const disconnected = await disconnectMailbox({
      organizationId,
      userId: ownerId,
    }, sql);
    assertEquals(disconnected.connectionId, null);

    let watchCalls = 0;
    const attemptedConnection = await connectMailbox({
      organizationId,
      userId: ownerId,
      providerAccountId,
      inboxEmail: providerAccountId,
      bundle: {
        accessToken: "synthetic-cancelled-access",
        refreshToken: "synthetic-cancelled-refresh",
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      },
      intentStateHash,
      startWatch: () => {
        watchCalls += 1;
        return Promise.resolve({
          historyId: "981",
          expiration: "1893456000000",
        });
      },
    }, sql).then(
      () => ({ error: null }),
      (error: unknown) => ({ error }),
    );
    assertEquals(attemptedConnection.error instanceof HttpError, true);
    assertEquals(
      attemptedConnection.error instanceof HttpError
        ? attemptedConnection.error.code
        : null,
      "gmail_connection_cancelled",
    );
    assertEquals(watchCalls, 0);
    const connections = await sql<{ count: number }[]>`
      select count(*)::integer as count
      from public.gmail_connections
      where organization_id = ${organizationId}
    `;
    assertEquals(connections[0]?.count, 0);
  } finally {
    await sql`
      delete from private.gmail_connection_intents
      where organization_id = ${organizationId}
    `.catch(() => undefined);
    await sql`
      delete from private.gmail_oauth_authorization_states
      where organization_id = ${organizationId}
    `.catch(() => undefined);
    await sql`
      delete from private.gmail_oauth_tokens
      where connection_id in (
        select id from public.gmail_connections
        where organization_id = ${organizationId}
      )
    `.catch(() => undefined);
    await sql`
      delete from public.gmail_sync_states
      where organization_id = ${organizationId}
    `.catch(() => undefined);
    await sql`
      delete from public.gmail_connections
      where organization_id = ${organizationId}
    `.catch(() => undefined);
    await sql.end();
  }
});
