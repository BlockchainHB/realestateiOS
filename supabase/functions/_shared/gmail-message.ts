import { base64UrlDecode } from "./crypto.ts";
import type { GoogleTokenBundle } from "./oauth.ts";
import { gmailApi } from "./oauth.ts";
import type { NormalizedEmail } from "./parser.ts";

interface GmailHeader {
  name?: string;
  value?: string;
}

interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; attachmentId?: string };
  parts?: GmailPart[];
}

interface GmailMessage {
  id: string;
  historyId?: string;
  internalDate?: string;
  payload?: GmailPart;
}

function collectHeaders(headers: GmailHeader[] = []): Record<string, string> {
  return Object.fromEntries(
    headers
      .filter((header) => header.name && header.value)
      .map((header) => [header.name!.toLowerCase(), header.value!]),
  );
}

function findTextPart(part: GmailPart | undefined): string | null {
  if (!part) return null;
  if (part.mimeType === "text/plain" && !part.filename && part.body?.data) {
    return new TextDecoder().decode(base64UrlDecode(part.body.data));
  }
  for (const child of part.parts ?? []) {
    const text = findTextPart(child);
    if (text !== null) return text;
  }
  return null;
}

export async function getNormalizedEmail(
  bundle: GoogleTokenBundle,
  messageId: string,
): Promise<NormalizedEmail> {
  const message = await gmailApi<GmailMessage>(
    bundle,
    `/messages/${encodeURIComponent(messageId)}?format=full`,
  );
  const headers = collectHeaders(message.payload?.headers);
  const internalDate = message.internalDate
    ? Number(message.internalDate)
    : Number.NaN;
  return {
    messageId: message.id,
    historyId: message.historyId ?? null,
    from: headers.from ?? "",
    subject: headers.subject ?? "",
    receivedAt: Number.isFinite(internalDate)
      ? new Date(internalDate).toISOString()
      : null,
    bodyText: findTextPart(message.payload) ?? "",
    headers,
  };
}
