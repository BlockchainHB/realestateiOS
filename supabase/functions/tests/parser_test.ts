import {
  assertEquals,
  assertNotEquals,
  assertRejects,
} from "jsr:@std/assert@1.0.14";
import {
  base64UrlEncode,
  constantTimeEqual,
  decryptJson,
  encryptJson,
  pkceChallenge,
  randomToken,
} from "../_shared/crypto.ts";
import { preservedHistoryCursor } from "../_shared/connections.ts";
import { getNormalizedEmail } from "../_shared/gmail-message.ts";
import { HttpError } from "../_shared/http.ts";
import {
  buildGoogleAuthorizationUrl,
  disconnectGoogleAccess,
  gmailRequestWithRefresh,
} from "../_shared/oauth.ts";
import type { NormalizedEmail } from "../_shared/parser.ts";
import { parsePaymentNotification } from "../_shared/parser.ts";
import { readPubSubNotification } from "../_shared/pubsub.ts";
import { gmailHistoryParameters } from "../_shared/sync.ts";

async function fixture(name: string): Promise<NormalizedEmail> {
  const path = new URL(`../../../fixtures/gmail/${name}`, import.meta.url);
  const document = JSON.parse(await Deno.readTextFile(path)) as
    & NormalizedEmail
    & {
      fixtureNotice?: string;
    };
  return document;
}

Deno.test("synthetic completed deposit fixture parses deterministically", async () => {
  const result = await parsePaymentNotification(
    await fixture("synthetic-deposit-completed.json"),
  );
  assertEquals(result.outcome, "parsed");
  if (result.outcome !== "parsed") return;
  assertEquals(result.eventType, "deposit_completed");
  assertEquals(result.amountMinor, 145000);
  assertEquals(result.currency, "CAD");
  assertEquals(result.providerReference, "SYNTHETIC-REF-001");
});

Deno.test("synthetic reversal always requires reconciliation review", async () => {
  const result = await parsePaymentNotification(
    await fixture("synthetic-reversal.json"),
  );
  assertEquals(result.outcome, "parsed");
  if (result.outcome === "parsed") {
    assertEquals(result.eventType, "deposit_reversed");
  }
});

Deno.test("suspected provider content without an approved parser is unsupported", async () => {
  const result = await parsePaymentNotification(
    await fixture("synthetic-unsupported.json"),
  );
  assertEquals(result.outcome, "unsupported");
});

Deno.test("unrelated email is ignored", async () => {
  const result = await parsePaymentNotification(
    await fixture("synthetic-unrelated.json"),
  );
  assertEquals(result.outcome, "ignored");
});

Deno.test("OAuth URL is state-bound, PKCE-protected, offline, and read-only", async () => {
  Deno.env.set("GOOGLE_OAUTH_CLIENT_ID", "synthetic-client.apps.example.test");
  Deno.env.set("GOOGLE_OAUTH_CLIENT_SECRET", "synthetic-test-value");
  Deno.env.set("GOOGLE_OAUTH_REDIRECT_URI", "https://example.test/callback");
  const verifier = randomToken(64);
  const challenge = await pkceChallenge(verifier);
  const url = new URL(
    buildGoogleAuthorizationUrl({
      state: "synthetic-state",
      codeChallenge: challenge,
    }),
  );
  assertEquals(url.searchParams.get("state"), "synthetic-state");
  assertEquals(url.searchParams.get("code_challenge"), challenge);
  assertEquals(url.searchParams.get("code_challenge_method"), "S256");
  assertEquals(url.searchParams.get("access_type"), "offline");
  assertEquals(
    url.searchParams.get("scope"),
    "https://www.googleapis.com/auth/gmail.readonly",
  );
});

Deno.test("server token envelope encrypts and detects tampering", async () => {
  const key = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of key) binary += String.fromCharCode(byte);
  Deno.env.set(
    "GMAIL_TOKEN_ENCRYPTION_KEY",
    btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, ""),
  );
  const ciphertext = await encryptJson({ refreshToken: "synthetic-token" });
  assertNotEquals(ciphertext.includes("synthetic-token"), true);
  assertEquals(
    await decryptJson<{ refreshToken: string }>(ciphertext),
    { refreshToken: "synthetic-token" },
  );
  const tampered = `${ciphertext.slice(0, -1)}${
    ciphertext.endsWith("A") ? "B" : "A"
  }`;
  await assertRejects(() => decryptJson(tampered));
});

Deno.test("Pub/Sub envelope accepts the configured subscription and Gmail cursor shape", async () => {
  Deno.env.set(
    "GOOGLE_PUBSUB_SUBSCRIPTION",
    "projects/synthetic/subscriptions/gmail-dev",
  );
  const payload = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify({
      emailAddress: "OWNER@EXAMPLE.TEST",
      historyId: "123456",
    })),
  );
  const request = new Request("https://example.test/pubsub", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      subscription: "projects/synthetic/subscriptions/gmail-dev",
      message: { messageId: "synthetic-pubsub-1", data: payload },
    }),
  });
  assertEquals(await readPubSubNotification(request), {
    pubsubMessageId: "synthetic-pubsub-1",
    emailAddress: "owner@example.test",
    historyId: "123456",
  });
});

Deno.test("maintenance secret comparison handles equal and unequal values", () => {
  assertEquals(constantTimeEqual("synthetic-secret", "synthetic-secret"), true);
  assertEquals(
    constantTimeEqual("synthetic-secret", "synthetic-secret-longer"),
    false,
  );
  assertEquals(
    constantTimeEqual("synthetic-secret", "synthetic-secreu"),
    false,
  );
});

Deno.test("watch setup preserves an existing Gmail history cursor", () => {
  assertEquals(preservedHistoryCursor("101", "999"), "101");
  assertEquals(preservedHistoryCursor(null, "999"), "999");
});

Deno.test("Gmail history synchronization is scoped to the watched inbox", () => {
  const parameters = gmailHistoryParameters("101", "next-page");
  assertEquals(parameters.get("startHistoryId"), "101");
  assertEquals(parameters.get("historyTypes"), "messageAdded");
  assertEquals(parameters.get("labelId"), "INBOX");
  assertEquals(parameters.get("pageToken"), "next-page");
});

Deno.test("Gmail 401 retries once with a refreshed token", async () => {
  const staleBundle = {
    accessToken: "synthetic-stale-access",
    refreshToken: "synthetic-refresh",
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
  };
  const refreshedBundle = {
    ...staleBundle,
    accessToken: "synthetic-refreshed-access",
  };
  const requestedTokens: string[] = [];
  const response = await gmailRequestWithRefresh(
    staleBundle,
    (bundle) => {
      requestedTokens.push(bundle.accessToken);
      if (bundle.accessToken === staleBundle.accessToken) {
        throw new HttpError(
          401,
          "gmail_reauthorization_required",
          "Synthetic expired access token.",
        );
      }
      return Promise.resolve("recovered");
    },
    () => Promise.resolve(refreshedBundle),
  );
  assertEquals(response.result, "recovered");
  assertEquals(response.bundle, refreshedBundle);
  assertEquals(requestedTokens, [
    "synthetic-stale-access",
    "synthetic-refreshed-access",
  ]);
});

Deno.test("permanently unavailable Gmail messages have a skippable error identity", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      Response.json({ error: "not_found" }, { status: 404 }),
    )) as typeof fetch;

  try {
    let caught: unknown;
    try {
      await getNormalizedEmail({
        accessToken: "synthetic-access",
        refreshToken: "synthetic-refresh",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      }, "permanently-deleted-message");
    } catch (error) {
      caught = error;
    }
    assertEquals(caught instanceof HttpError, true);
    if (caught instanceof HttpError) {
      assertEquals(caught.status, 404);
      assertEquals(caught.code, "gmail_message_not_found");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("Google grant revocation is attempted after refresh and watch failures", async () => {
  Deno.env.set("GOOGLE_OAUTH_CLIENT_ID", "synthetic-client.apps.example.test");
  Deno.env.set("GOOGLE_OAUTH_CLIENT_SECRET", "synthetic-test-value");
  const requestedUrls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
    requestedUrls.push(url);
    if (url === "https://oauth2.googleapis.com/token") {
      return Promise.resolve(Response.json({ error: "invalid_grant" }, {
        status: 400,
      }));
    }
    if (url.endsWith("/gmail/v1/users/me/stop")) {
      return Promise.resolve(Response.json({ error: "expired" }, {
        status: 401,
      }));
    }
    if (url === "https://oauth2.googleapis.com/revoke") {
      return Promise.resolve(new Response(null, { status: 200 }));
    }
    return Promise.reject(new Error(`Unexpected synthetic URL: ${url}`));
  }) as typeof fetch;

  try {
    const outcome = await disconnectGoogleAccess({
      accessToken: "synthetic-expired-access",
      refreshToken: "synthetic-refresh",
      expiresAt: new Date(0).toISOString(),
      scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    });
    assertEquals(outcome, {
      revocation: "revoked",
      tokenRefreshFailed: true,
      watchStopFailed: true,
    });
    assertEquals(requestedUrls, [
      "https://oauth2.googleapis.com/token",
      "https://gmail.googleapis.com/gmail/v1/users/me/stop",
      "https://oauth2.googleapis.com/revoke",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
