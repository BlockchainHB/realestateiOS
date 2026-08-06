import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { connectMailbox } from "../_shared/connections.ts";
import { HttpError, jsonResponse } from "../_shared/http.ts";
import {
  exchangeAuthorizationCode,
  readGoogleMailboxIdentity,
  startGmailWatch,
} from "../_shared/oauth.ts";
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

    try {
      const bundle = await exchangeAuthorizationCode(code, state.codeVerifier);
      const mailbox = await readGoogleMailboxIdentity(bundle);
      const watch = await startGmailWatch(bundle);
      await connectMailbox({
        organizationId: state.organizationId,
        userId: state.userId,
        providerAccountId: mailbox.emailAddress.toLowerCase(),
        inboxEmail: mailbox.emailAddress,
        bundle,
        watch,
      });
      return completionRedirect(state.returnUrl, "connected");
    } catch (error) {
      const code = error instanceof HttpError
        ? error.code
        : "gmail_connection_failed";
      console.error("Gmail OAuth callback failed", { code });
      return completionRedirect(state.returnUrl, "error", code);
    }
  }),
};
