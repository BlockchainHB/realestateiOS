import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { requireOrganizationOwner } from "../_shared/authorization.ts";
import {
  disconnectMailbox,
  organizationConnection,
} from "../_shared/connections.ts";
import { database } from "../_shared/database.ts";
import {
  errorResponse,
  HttpError,
  jsonResponse,
  readJson,
} from "../_shared/http.ts";
import { revokeGoogleToken, stopGmailWatch } from "../_shared/oauth.ts";
import { loadToken } from "../_shared/token-store.ts";

export default {
  fetch: withSupabase({ auth: "user" }, async (request, ctx) => {
    try {
      if (request.method === "GET") {
        const organizationId = new URL(request.url).searchParams.get(
          "organization_id",
        );
        if (!organizationId) {
          throw new HttpError(
            400,
            "organization_required",
            "An organization identifier is required.",
          );
        }
        await requireOrganizationOwner(ctx, organizationId);
        const rows = await database()<{
          id: string;
          inbox_email: string;
          status: string;
          last_successful_sync_at: string | null;
          watch_expiration: string | null;
          sync_status: string | null;
        }[]>`
          select connection.id,
                 connection.inbox_email,
                 connection.status,
                 connection.last_successful_sync_at,
                 state.watch_expiration,
                 state.status as sync_status
          from public.gmail_connections connection
          left join public.gmail_sync_states state on state.connection_id = connection.id
          where connection.organization_id = ${organizationId}
        `;
        return jsonResponse({ connection: rows[0] ?? null });
      }
      if (request.method === "DELETE") {
        const body = await readJson<{ organizationId?: string }>(request);
        if (!body.organizationId) {
          throw new HttpError(
            400,
            "organization_required",
            "An organization identifier is required.",
          );
        }
        const userId = await requireOrganizationOwner(ctx, body.organizationId);
        const connection = await organizationConnection(body.organizationId);
        if (!connection) return jsonResponse({ disconnected: true });
        const bundle = await loadToken(connection.id);
        let revocationOutcome = "token_missing";
        if (bundle) {
          try {
            await stopGmailWatch(bundle);
            await revokeGoogleToken(bundle.refreshToken);
            revocationOutcome = "revoked";
          } catch (error) {
            revocationOutcome = "provider_unreachable";
            console.error("Google revocation failed during local disconnect", {
              code: error instanceof HttpError ? error.code : "unknown",
            });
          }
        }
        await disconnectMailbox({
          connectionId: connection.id,
          organizationId: body.organizationId,
          userId,
          revocationOutcome,
        });
        return jsonResponse({ disconnected: true });
      }
      throw new HttpError(405, "method_not_allowed", "Use GET or DELETE.");
    } catch (error) {
      return errorResponse(error);
    }
  }),
};
