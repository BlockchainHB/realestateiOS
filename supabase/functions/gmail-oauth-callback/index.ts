import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import {
  cleanupProviderAccessIfUnused,
  connectMailbox,
  requireCompatibleMailbox,
} from "../_shared/connections.ts";
import { HttpError, jsonResponse } from "../_shared/http.ts";
import {
  disconnectGoogleAccess,
  exchangeAuthorizationCode,
  type GoogleTokenBundle,
  readGoogleMailboxIdentity,
  startGmailWatch,
} from "../_shared/oauth.ts";
import { synchronizeConnection } from "../_shared/sync.ts";
import { consumeAuthorizationState } from "../_shared/token-store.ts";

function completionRedirect(
  returnUrl: string,
  status: "connected" | "error",
  code?: string,
): Response {
  const url = new URL(returnUrl);
  url.searchParams.set("gmail_status", status);
  if (code) url.searchParams.set("error", code);
  return Response.redirect(url, 302);
}

export default {
  fetch: withSupabase({ auth: "none" }, async (request) => {
    if (request.method !== "GET") {
      return jsonResponse({ error: { code: "method_not_allowed" } }, 405);
    }
    const url = new URL(request.url);
    const stateValue = url.searchParams.get("state");
    if (!stateValue) {
      return jsonResponse({ error: { code: "state_required" } }, 400);
    }
    const state = await consumeAuthorizationState(stateValue);
    if (!state) {
      return jsonResponse({ error: { code: "invalid_or_expired_state" } }, 400);
    }
    const providerError = url.searchParams.get("error");
    if (providerError) {
      return completionRedirect(
        state.returnUrl,
        "error",
        "google_authorization_denied",
      );
    }
    const code = url.searchParams.get("code");
    if (!code) {
      return completionRedirect(
        state.returnUrl,
        "error",
        "authorization_code_missing",
      );
    }

    let issuedBundle: GoogleTokenBundle | null = null;
    let issuedProviderAccountId: string | null = null;
    let connectionStored = false;
    try {
      issuedBundle = await exchangeAuthorizationCode(code, state.codeVerifier);
      const mailbox = await readGoogleMailboxIdentity(issuedBundle);
      issuedProviderAccountId = mailbox.emailAddress.toLowerCase();
      await requireCompatibleMailbox(
        state.organizationId,
        mailbox.emailAddress,
      );
      const watch = await startGmailWatch(issuedBundle);
      const connectionId = await connectMailbox({
        organizationId: state.organizationId,
        userId: state.userId,
        providerAccountId: issuedProviderAccountId,
        inboxEmail: mailbox.emailAddress,
        bundle: issuedBundle,
        watch,
      });
      connectionStored = true;
      try {
        await synchronizeConnection(connectionId, watch.historyId);
      } catch (error) {
        console.error("Gmail catch-up synchronization was delayed", {
          code: error instanceof HttpError ? error.code : "sync_failed",
        });
      }
      return completionRedirect(state.returnUrl, "connected");
    } catch (error) {
      if (issuedBundle && !connectionStored) {
        const bundleToCleanup = issuedBundle;
        const cleanup = issuedProviderAccountId
          ? await cleanupProviderAccessIfUnused(
            issuedProviderAccountId,
            () => disconnectGoogleAccess(bundleToCleanup),
          )
          : {
            attempted: true,
            result: await disconnectGoogleAccess(bundleToCleanup),
          };
        if (cleanup.attempted && cleanup.result) {
          console.error("Failed Gmail authorization cleanup was attempted", {
            provider_revocation: cleanup.result.revocation,
            token_refresh_failed: cleanup.result.tokenRefreshFailed,
            watch_stop_failed: cleanup.result.watchStopFailed,
          });
        } else {
          console.error(
            "Failed Gmail authorization cleanup preserved shared mailbox access",
          );
        }
      }
      const code = error instanceof HttpError
        ? error.code
        : "gmail_connection_failed";
      console.error("Gmail OAuth callback failed", { code });
      return completionRedirect(state.returnUrl, "error", code);
    }
  }),
};
