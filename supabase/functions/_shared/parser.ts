import { sha256Hex } from "./crypto.ts";

export const SYNTHETIC_PARSER_VERSION = "synthetic-interac-v1";
export const SYNTHETIC_FIXTURE_HEADER =
  "x-realestate-synthetic-interac-fixture";

export interface NormalizedEmail {
  messageId: string;
  historyId: string | null;
  from: string;
  subject: string;
  receivedAt: string | null;
  bodyText: string;
  headers: Record<string, string>;
}

export type ParserResult =
  | { outcome: "ignored"; parserVersion: string }
  | {
    outcome: "unsupported";
    parserVersion: string;
    suspectedProvider: "interac";
  }
  | {
    outcome: "parsed";
    parserVersion: string;
    eventType: "deposit_completed" | "deposit_cancelled" | "deposit_reversed";
    payerFingerprint: string;
    senderDisplayName: string;
    amountMinor: number;
    currency: "CAD";
    receivedAt: string;
    providerReference: string;
  };

function looksLikeInterac(email: NormalizedEmail): boolean {
  const searchable = `${email.from} ${email.subject}`.toLowerCase();
  return searchable.includes("interac") || searchable.includes("e-transfer");
}

function requiredLine(body: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return body.match(new RegExp(`^${escaped}:\\s*(.+)$`, "imu"))?.[1]?.trim() ??
    null;
}

function parseCadMinorUnits(value: string): number | null {
  const match = value.match(/^(\d{1,9})\.(\d{2})$/u);
  if (!match) return null;
  const amount = Number(match[1]) * 100 + Number(match[2]);
  return Number.isSafeInteger(amount) ? amount : null;
}

export async function parsePaymentNotification(
  email: NormalizedEmail,
): Promise<ParserResult> {
  if (!looksLikeInterac(email)) {
    return { outcome: "ignored", parserVersion: SYNTHETIC_PARSER_VERSION };
  }
  if (email.headers[SYNTHETIC_FIXTURE_HEADER] !== "v1") {
    return {
      outcome: "unsupported",
      parserVersion: SYNTHETIC_PARSER_VERSION,
      suspectedProvider: "interac",
    };
  }

  const event = requiredLine(email.bodyText, "Event");
  const sender = requiredLine(email.bodyText, "Sender");
  const amount = requiredLine(email.bodyText, "Amount CAD");
  const receivedAt = requiredLine(email.bodyText, "Received At");
  const reference = requiredLine(email.bodyText, "Reference");
  const allowedEvents = new Set([
    "deposit_completed",
    "deposit_cancelled",
    "deposit_reversed",
  ]);
  const amountMinor = amount ? parseCadMinorUnits(amount) : null;
  const parsedDate = receivedAt ? Date.parse(receivedAt) : Number.NaN;

  if (
    !event || !allowedEvents.has(event) || !sender || amountMinor === null ||
    !receivedAt || !Number.isFinite(parsedDate) || !reference
  ) {
    return {
      outcome: "unsupported",
      parserVersion: SYNTHETIC_PARSER_VERSION,
      suspectedProvider: "interac",
    };
  }

  return {
    outcome: "parsed",
    parserVersion: SYNTHETIC_PARSER_VERSION,
    eventType: event as
      | "deposit_completed"
      | "deposit_cancelled"
      | "deposit_reversed",
    payerFingerprint: await sha256Hex(sender.trim().toLowerCase()),
    senderDisplayName: sender,
    amountMinor,
    currency: "CAD",
    receivedAt: new Date(parsedDate).toISOString(),
    providerReference: reference,
  };
}
