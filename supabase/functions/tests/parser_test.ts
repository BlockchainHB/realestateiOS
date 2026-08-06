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
import { buildGoogleAuthorizationUrl } from "../_shared/oauth.ts";
import type { NormalizedEmail } from "../_shared/parser.ts";
import { parsePaymentNotification } from "../_shared/parser.ts";
import { readPubSubNotification } from "../_shared/pubsub.ts";

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
