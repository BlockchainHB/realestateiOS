import { sha256Hex } from "../_shared/crypto.ts";
import type { NormalizedEmail, ParserResult } from "../_shared/parser.ts";

const SYNTHETIC_PARSER_VERSION = "synthetic-interac-v1";
const SYNTHETIC_FIXTURE_HEADER = "x-realestate-synthetic-interac-fixture";

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

export async function parseSyntheticPaymentFixture(
  email: NormalizedEmail,
): Promise<ParserResult> {
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
