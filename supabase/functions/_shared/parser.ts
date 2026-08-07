export const INTERAC_PARSER_VERSION = "interac-unconfigured-v1";

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

export async function parsePaymentNotification(
  email: NormalizedEmail,
): Promise<ParserResult> {
  if (!looksLikeInterac(email)) {
    return { outcome: "ignored", parserVersion: INTERAC_PARSER_VERSION };
  }
  return {
    outcome: "unsupported",
    parserVersion: INTERAC_PARSER_VERSION,
    suspectedProvider: "interac",
  };
}
