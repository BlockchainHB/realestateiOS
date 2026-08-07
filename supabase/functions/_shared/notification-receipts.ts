import { database } from "./database.ts";

export async function claimNotificationReceipt(
  pubsubMessageId: string,
  notifiedHistoryId: string,
  sql = database(),
): Promise<boolean> {
  const claimed = await sql<{ pubsub_message_id: string }[]>`
    insert into private.gmail_notification_receipts (
      pubsub_message_id,
      notified_history_id,
      outcome
    ) values (
      ${pubsubMessageId},
      ${notifiedHistoryId},
      'processing'
    )
    on conflict (pubsub_message_id) do update
    set notified_history_id = excluded.notified_history_id,
        received_at = now(),
        processed_at = null,
        outcome = 'processing',
        error_code = null
    where private.gmail_notification_receipts.outcome = 'failed'
       or (
         private.gmail_notification_receipts.outcome = 'processing'
         and private.gmail_notification_receipts.received_at <= now() - interval '5 minutes'
       )
    returning pubsub_message_id
  `;
  return Boolean(claimed[0]);
}
