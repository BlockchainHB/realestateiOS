import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { requireOrganizationOwner } from "../_shared/authorization.ts";
import {
  completeRevocationCleanup,
  disconnectMailbox,
  organizationConnection,
  pendingRevocationToken,
} from "../_shared/connections.ts";
import { database } from "../_shared/database.ts";
import {
  errorResponse,
  HttpError,
  jsonResponse,
  readJson,
} from "../_shared/http.ts";
import { disconnectGoogleAccess, revokeGoogleToken } from "../_shared/oauth.ts";
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
        if (connection.status !== "disconnected" || bundle) {
          await disconnectMailbox({
            connectionId: connection.id,
            organizationId: body.organizationId,
            userId,
            refreshToken: bundle?.refreshToken ?? null,
          });
        }

        let revocationConfirmed = false;
        if (bundle) {
          const outcome = await disconnectGoogleAccess(bundle);
          if (outcome.tokenRefreshFailed || outcome.watchStopFailed) {
            console.error("Google watch shutdown was incomplete", {
              token_refresh_failed: outcome.tokenRefreshFailed,
              watch_stop_failed: outcome.watchStopFailed,
            });
          }
          revocationConfirmed = outcome.revocation === "revoked";
        } else {
          const pendingRefreshToken = await pendingRevocationToken(
            connection.id,
          );
          if (pendingRefreshToken) {
            try {
              await revokeGoogleToken(pendingRefreshToken);
              revocationConfirmed = true;
            } catch {
              revocationConfirmed = false;
            }
          } else {
            return jsonResponse({ disconnected: true });
          }
        }
        if (!revocationConfirmed) {
          console.error("Google grant revocation was not confirmed");
          throw new HttpError(
            502,
            "google_revocation_failed",
            "The mailbox is disconnected locally, but Google revocation still needs a retry.",
          );
        }
        await completeRevocationCleanup({
          connectionId: connection.id,
          organizationId: body.organizationId,
          userId,
        });
        return jsonResponse({ disconnected: true });
      }
      throw new HttpError(405, "method_not_allowed", "Use GET or DELETE.");
    } catch (error) {
      return errorResponse(error);
    }
  }),
};
