import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { connectedMailboxesByEmail } from "../_shared/connections.ts";
import { database } from "../_shared/database.ts";
import { errorResponse, HttpError, requireMethod } from "../_shared/http.ts";
import { claimNotificationReceipt } from "../_shared/notification-receipts.ts";
import {
  readPubSubNotification,
  verifyPubSubBearer,
} from "../_shared/pubsub.ts";
import { synchronizeConnection } from "../_shared/sync.ts";

export default {
  fetch: withSupabase({ auth: "none" }, async (request) => {
    let receiptId: string | undefined;
    try {
      requireMethod(request, "POST");
      await verifyPubSubBearer(request);
      const notification = await readPubSubNotification(request);
      receiptId = notification.pubsubMessageId;
      const sql = database();
      if (
        !await claimNotificationReceipt(
          notification.pubsubMessageId,
          notification.historyId,
        )
      ) return new Response(null, { status: 204 });

      const connections = await connectedMailboxesByEmail(
        notification.emailAddress,
      );
      if (connections.length === 0) {
        await sql`
          update private.gmail_notification_receipts
          set outcome = 'processed', processed_at = now(), error_code = 'connection_not_found'
          where pubsub_message_id = ${notification.pubsubMessageId}
        `;
        return new Response(null, { status: 204 });
      }
      for (const connection of connections) {
        await synchronizeConnection(connection.id, notification.historyId);
      }
      await sql`
        update private.gmail_notification_receipts
        set connection_id = ${
        connections.length === 1 ? connections[0].id : null
      },
            outcome = 'processed',
            processed_at = now(),
            error_code = null
        where pubsub_message_id = ${notification.pubsubMessageId}
      `;
      return new Response(null, { status: 204 });
    } catch (error) {
      if (receiptId) {
        await database()`
          update private.gmail_notification_receipts
          set outcome = 'failed',
              error_code = ${
          error instanceof HttpError ? error.code : "processing_failed"
        }
          where pubsub_message_id = ${receiptId}
        `;
      }
      return errorResponse(error);
    }
  }),
};
