import { assertEquals, assertMatch } from "jsr:@std/assert@1.0.14";
import postgres from "npm:postgres@3.4.9";

const databaseUrl = Deno.env.get("SUPABASE_DB_URL");
if (!databaseUrl) throw new Error("SUPABASE_DB_URL is required");

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
