import { sha256Hex } from "./crypto.ts";
import { database } from "./database.ts";
import { HttpError } from "./http.ts";
import type { NormalizedEmail } from "./parser.ts";
import { parsePaymentNotification } from "./parser.ts";

export async function ingestEmailSourceEvent(input: {
  connectionId: string;
  organizationId: string;
  email: NormalizedEmail;
}): Promise<"ignored" | "duplicate" | "created"> {
  const parsed = await parsePaymentNotification(input.email);
  if (parsed.outcome === "ignored") return "ignored";
  const contentSha256 = await sha256Hex(input.email.bodyText);
  const sql = database();

  return await sql.begin(async (transaction) => {
    const activeConnections = await transaction<{ id: string }[]>`
      select id
      from public.gmail_connections
      where id = ${input.connectionId}
        and organization_id = ${input.organizationId}
        and status <> 'disconnected'
      for key share
    `;
    if (!activeConnections[0]) {
      throw new HttpError(
        409,
        "gmail_not_connected",
        "The Gmail connection was disconnected before intake completed.",
      );
    }

    const events = await transaction<{ id: string }[]>`
      insert into public.payment_source_events (
        organization_id,
        connection_id,
        provider_message_id,
        provider_history_id,
        event_type,
        parse_outcome,
        parser_version,
        payer_fingerprint,
        sender_display_name,
        amount_minor,
        currency,
        received_at,
        provider_reference,
        content_sha256
      ) values (
        ${input.organizationId},
        ${input.connectionId},
        ${input.email.messageId},
        ${input.email.historyId},
        ${parsed.outcome === "parsed" ? parsed.eventType : "unsupported"},
        ${parsed.outcome},
        ${parsed.parserVersion},
        ${parsed.outcome === "parsed" ? parsed.payerFingerprint : null},
        ${parsed.outcome === "parsed" ? parsed.senderDisplayName : null},
        ${parsed.outcome === "parsed" ? parsed.amountMinor : null},
        ${parsed.outcome === "parsed" ? parsed.currency : null},
        ${
      parsed.outcome === "parsed" ? parsed.receivedAt : input.email.receivedAt
    },
        ${parsed.outcome === "parsed" ? parsed.providerReference : null},
        ${contentSha256}
      )
      on conflict (connection_id, provider_message_id) do nothing
      returning id
    `;
    const sourceEventId = events[0]?.id;
    if (!sourceEventId) return "duplicate";

    if (parsed.outcome === "parsed") {
      await transaction`
        insert into public.payer_identities (
          organization_id,
          payer_fingerprint,
          display_name
        ) values (
          ${input.organizationId},
          ${parsed.payerFingerprint},
          ${parsed.senderDisplayName}
        )
        on conflict (organization_id, payer_fingerprint) do nothing
      `;
      await transaction`
        insert into public.reconciliation_decisions (
          organization_id,
          source_event_id,
          outcome,
          reason_code
        ) values (
          ${input.organizationId},
          ${sourceEventId},
          ${
        parsed.eventType === "deposit_completed"
          ? "pending_review"
          : "reversal_pending"
      },
          ${
        parsed.eventType === "deposit_completed"
          ? "first_sender_review_required"
          : "owner_confirmation_required"
      }
        )
      `;
    }

    await transaction`
      insert into public.audit_events (
        organization_id,
        event_type,
        target_type,
        target_id,
        metadata
      ) values (
        ${input.organizationId},
        'gmail.source_event_recorded',
        'payment_source_event',
        ${sourceEventId},
        ${
      transaction.json({
        parse_outcome: parsed.outcome,
        parser_version: parsed.parserVersion,
      })
    }
      )
    `;
    return "created";
  });
}
