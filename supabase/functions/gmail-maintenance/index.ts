import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { requireEnv } from "../_shared/config.ts";
import { constantTimeEqual } from "../_shared/crypto.ts";
import { database } from "../_shared/database.ts";
import {
  errorResponse,
  HttpError,
  jsonResponse,
  readJson,
  requireMethod,
} from "../_shared/http.ts";
import {
  renewConnectionWatch,
  synchronizeConnection,
} from "../_shared/sync.ts";

export default {
  fetch: withSupabase({ auth: "none" }, async (request) => {
    try {
      requireMethod(request, "POST");
      const providedSecret = request.headers.get("x-gmail-cron-secret") ?? "";
      if (!constantTimeEqual(providedSecret, requireEnv("GMAIL_CRON_SECRET"))) {
        throw new HttpError(
          401,
          "invalid_maintenance_secret",
          "Maintenance authentication failed.",
        );
      }
      const body = await readJson<
        { action?: "renew_watches" | "recovery_sync" }
      >(request);
      if (!body.action) {
        throw new HttpError(
          400,
          "action_required",
          "A maintenance action is required.",
        );
      }
      const sql = database();
      const connectionRows = body.action === "renew_watches"
        ? await sql<{ id: string }[]>`
          select connection.id
          from public.gmail_connections connection
          join public.gmail_sync_states state on state.connection_id = connection.id
          where connection.status <> 'disconnected'
            and (state.watch_expiration is null or state.watch_expiration < now() + interval '2 days')
        `
        : await sql<{ id: string }[]>`
          select connection.id
          from public.gmail_connections connection
          join public.gmail_sync_states state on state.connection_id = connection.id
          where connection.status <> 'disconnected'
            and (
              connection.last_successful_sync_at is null
              or connection.last_successful_sync_at < now() - interval '15 minutes'
              or state.status in ('delayed', 'failed')
            )
        `;

      const outcomes: Array<{ connectionId: string; status: "ok" | "failed" }> =
        [];
      for (const connection of connectionRows) {
        try {
          if (body.action === "renew_watches") {
            await renewConnectionWatch(connection.id);
          } else await synchronizeConnection(connection.id);
          outcomes.push({ connectionId: connection.id, status: "ok" });
        } catch {
          outcomes.push({ connectionId: connection.id, status: "failed" });
        }
      }
      return jsonResponse({ action: body.action, outcomes });
    } catch (error) {
      return errorResponse(error);
    }
  }),
};
