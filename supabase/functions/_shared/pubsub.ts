import { createRemoteJWKSet, jwtVerify } from "npm:jose@6.2.8";
import { base64UrlDecode } from "./crypto.ts";
import { pubsubConfig, requireEnv } from "./config.ts";
import { HttpError } from "./http.ts";

const googleJwks = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);

export interface GmailPubSubNotification {
  pubsubMessageId: string;
  emailAddress: string;
  historyId: string;
}

export async function verifyPubSubBearer(request: Request): Promise<void> {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    throw new HttpError(
      401,
      "pubsub_authentication_required",
      "Authenticated Pub/Sub push is required.",
    );
  }
  const config = pubsubConfig();
  try {
    const { payload } = await jwtVerify(authorization.slice(7), googleJwks, {
      audience: config.audience,
      issuer: ["accounts.google.com", "https://accounts.google.com"],
    });
    if (
      payload.email !== config.serviceAccountEmail ||
      payload.email_verified !== true
    ) {
      throw new Error("Unexpected Pub/Sub service account");
    }
  } catch {
    throw new HttpError(
      401,
      "invalid_pubsub_token",
      "The Pub/Sub identity token is invalid.",
    );
  }
}

export async function readPubSubNotification(
  request: Request,
): Promise<GmailPubSubNotification> {
  const envelope = await request.json() as {
    message?: { messageId?: string; data?: string };
    subscription?: string;
  };
  if (envelope.subscription !== requireEnv("GOOGLE_PUBSUB_SUBSCRIPTION")) {
    throw new HttpError(
      400,
      "unexpected_subscription",
      "The Pub/Sub subscription is not recognized.",
    );
  }
  if (!envelope.message?.messageId || !envelope.message.data) {
    throw new HttpError(
      400,
      "invalid_pubsub_envelope",
      "The Pub/Sub message is incomplete.",
    );
  }
  let payload: { emailAddress?: string; historyId?: string };
  try {
    payload = JSON.parse(
      new TextDecoder().decode(base64UrlDecode(envelope.message.data)),
    ) as { emailAddress?: string; historyId?: string };
  } catch {
    throw new HttpError(
      400,
      "invalid_pubsub_payload",
      "The Gmail notification payload is invalid.",
    );
  }
  if (!payload.emailAddress || !payload.historyId?.match(/^[0-9]+$/u)) {
    throw new HttpError(
      400,
      "invalid_gmail_notification",
      "The Gmail notification is incomplete.",
    );
  }
  return {
    pubsubMessageId: envelope.message.messageId,
    emailAddress: payload.emailAddress.toLowerCase(),
    historyId: payload.historyId,
  };
}
