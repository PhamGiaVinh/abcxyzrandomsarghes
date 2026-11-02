// Shared utilities for staking edge functions.
// Extracted by fallow duplication analysis (9 instances of boilerplate).
// All corsHeaders/json/auth/role/club patterns now live here.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { retryFetch } from "./retry.ts";

export type SupabaseAdmin = any;

/** Standard CORS headers for all staking functions. */
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** JSON response helper. Call `json(body, status)` to produce a Response. */
export function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Create a Supabase admin client (service_role key, no auth header). */
export function createAdminClient(options: { retry?: boolean } = {}) {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { global: { fetch: options.retry === false ? fetch : retryFetch } },
  );
}

/**
 * Authenticate a request and return the caller's uid.
 * Returns an error Response if auth fails; on success returns { uid }.
 */
export async function authenticateUser(
  req: Request,
): Promise<{ uid: string } | Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing auth" }, 401);

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { global: { headers: { Authorization: authHeader }, fetch: retryFetch } },
  );
  const { data: userData } = await userClient.auth.getUser();
  if (!userData?.user) return json({ error: "Invalid token" }, 401);

  return { uid: userData.user.id };
}

/**
 * Check that the caller has super_admin or cashier role.
 * Returns `{ isSuper, isCashier }` on success, or an error Response if forbidden.
 */
export async function requireAdminRoles(
  admin: SupabaseAdmin,
  uid: string,
): Promise<{ isSuper: boolean; isCashier: boolean } | Response> {
  const { data: roles, error } = await admin
    .from("user_roles").select("role")
    .eq("user_id", uid).in("role", ["super_admin", "cashier"]);

  if (error || !Array.isArray(roles)) return json({ error: "Permission check unavailable" }, 503);
  const roleSet = new Set(roles.map((r: any) => r.role));
  const isSuper = roleSet.has("super_admin");
  const isCashier = roleSet.has("cashier");
  if (!isSuper && !isCashier) return json({ error: "Forbidden" }, 403);

  return { isSuper, isCashier };
}

/**
 * For cashiers (not super_admins), verify they are assigned to the deal's club.
 * Returns void on success, or an error Response if forbidden.
 */
export async function requireClubAccess(
  admin: SupabaseAdmin,
  uid: string,
  clubId: string | null,
): Promise<void | Response> {
  if (!clubId) return json({ error: "Forbidden: deal không gắn CLB" }, 403);

  const { data: ok, error } = await admin.rpc("is_club_cashier", {
    _user_id: uid,
    _club_id: clubId,
  });
  if (error || typeof ok !== "boolean") return json({ error: "Permission check unavailable" }, 503);
  if (!ok) return json({ error: "Forbidden: bạn không được gán cashier cho CLB này" }, 403);
}
