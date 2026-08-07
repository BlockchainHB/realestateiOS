import type { SupabaseClient } from "npm:@supabase/supabase-js@2.112.2";
import { HttpError } from "./http.ts";

export function authenticatedUserId(ctx: {
  userClaims?: { sub?: string; id?: string } | null;
}): string {
  const userId = ctx.userClaims?.sub ?? ctx.userClaims?.id;
  if (!userId) {
    throw new HttpError(401, "authentication_required", "Sign in is required.");
  }
  return userId;
}

export async function requireOrganizationOwner(
  ctx: {
    supabaseAdmin: SupabaseClient;
    userClaims?: { sub?: string; id?: string } | null;
  },
  organizationId: string,
): Promise<string> {
  const userId = authenticatedUserId(ctx);
  const { data, error } = await ctx.supabaseAdmin
    .from("organization_memberships")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("role", "owner")
    .is("revoked_at", null)
    .maybeSingle();
  if (error) {
    throw new Error(`Owner authorization lookup failed: ${error.message}`);
  }
  if (!data) {
    throw new HttpError(
      403,
      "owner_required",
      "Only an organization owner may perform this action.",
    );
  }
  return userId;
}
