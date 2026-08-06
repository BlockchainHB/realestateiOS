import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { requireOrganizationOwner } from "../_shared/authorization.ts";
import { requireEnv } from "../_shared/config.ts";
import { pkceChallenge, randomToken } from "../_shared/crypto.ts";
import {
  errorResponse,
  HttpError,
  jsonResponse,
  readJson,
  requireMethod,
} from "../_shared/http.ts";
import { buildGoogleAuthorizationUrl } from "../_shared/oauth.ts";
import { storeAuthorizationState } from "../_shared/token-store.ts";

export default {
  fetch: withSupabase({ auth: "user" }, async (request, ctx) => {
    try {
      requireMethod(request, "POST");
      const body = await readJson<{ organizationId?: string }>(request);
      if (!body.organizationId?.match(/^[0-9a-f-]{36}$/iu)) {
        throw new HttpError(
          400,
          "organization_required",
          "A valid organization identifier is required.",
        );
      }
      const userId = await requireOrganizationOwner(ctx, body.organizationId);
      const state = randomToken(32);
      const codeVerifier = randomToken(64);
      const codeChallenge = await pkceChallenge(codeVerifier);
      await storeAuthorizationState({
        state,
        organizationId: body.organizationId,
        userId,
        codeVerifier,
        returnUrl: requireEnv("IOS_GMAIL_RETURN_URL"),
      });
      return jsonResponse({
        authorizationUrl: buildGoogleAuthorizationUrl({ state, codeChallenge }),
        expiresInSeconds: 600,
      });
    } catch (error) {
      return errorResponse(error);
    }
  }),
};
