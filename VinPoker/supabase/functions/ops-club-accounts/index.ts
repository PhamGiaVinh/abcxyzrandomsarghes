// Owner-gated Ops invitations. Browser sends intent only; server verifies Owner.
// Membership, invitation ledger and invitation events are one RPC transaction. This function
// is only responsible for Auth email delivery and calling that transaction.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  authenticateUser,
  corsHeaders,
  json,
  type SupabaseAdmin,
} from "../_shared/staking-common.ts";

type OperatorRole = "floor" | "cashier" | "dealer_control";
type InviteRequest = {
  action: "invite";
  club_id: string;
  email: string;
  operator_role: OperatorRole;
};
type RevokeRequest = { action: "revoke"; invite_id: string };
type AuthUser = {
  id: string;
  email?: string;
  email_confirmed_at?: string | null;
};

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 320
    ? email
    : null;
}
export function isEnabledOperatorRole(value: unknown, dealerControlFlag?: string): value is OperatorRole {
  return value === "floor" || value === "cashier" ||
    (value === "dealer_control" && dealerControlFlag === "true");
}
function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value);
}

// Environment configuration is intentionally fail-closed. The Auth Redirect URL
// allowlist itself is configured in Supabase; deployment preflight must confirm it.
export function inviteRedirectTo(env = Deno.env): string | null {
  const configured = env.get("OPS_INVITE_REDIRECT_TO");
  const expectedOrigin = env.get("OPS_INVITE_EXPECTED_ORIGIN");
  if (!configured || !expectedOrigin) return null;
  try {
    const url = new URL(configured);
    const expected = new URL(expectedOrigin);
    return url.protocol === "https:" && expected.protocol === "https:" &&
        url.origin === expected.origin &&
        url.pathname === "/ops/auth/callback" &&
        expected.pathname === "/"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export async function findUserByEmail(
  admin: SupabaseAdmin,
  email: string,
): Promise<AuthUser | null> {
  // No client-supplied Auth user ID; this is the available Admin lookup seam.
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw new Error("AUTH_LOOKUP_FAILED");
    const match = data.users.find((candidate: AuthUser) =>
      candidate.email?.toLowerCase() === email
    );
    if (match) return match;
    if (data.users.length < 1000) return null;
  }
  throw new Error("AUTH_LOOKUP_LIMIT");
}
async function isOwner(admin: SupabaseAdmin, clubId: string, actorId: string) {
  const { data, error } = await admin.from("clubs").select("id").eq(
    "id",
    clubId,
  )
    .eq("owner_id", actorId).maybeSingle();
  return !error && Boolean(data?.id);
}

type InviteDelivery = {
  user: AuthUser;
  sent: boolean;
  deliveryOutcome: "sent" | "resent" | "not_required";
};
export async function resolveInviteDelivery(
  admin: SupabaseAdmin,
  email: string,
  redirectTo: string,
): Promise<InviteDelivery> {
  const existing = await findUserByEmail(admin, email);
  if (existing?.email_confirmed_at) {
    return { user: existing, sent: false, deliveryOutcome: "not_required" };
  }

  // Auth owns delivery and rate limiting. For an existing unconfirmed account,
  // inviteUserByEmail is the only built-in re-invite attempt available here; an
  // error is fail-closed rather than silently claiming the email was resent.
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
  });
  if (error || !data.user) throw new Error("INVITE_DELIVERY_FAILED");
  if (existing && data.user.id !== existing.id) {
    throw new Error("INVITE_RESEND_ID_MISMATCH");
  }
  return {
    user: data.user,
    sent: true,
    deliveryOutcome: existing ? "resent" : "sent",
  };
}

export async function applyInvite(
  admin: SupabaseAdmin,
  input: {
    actorId: string;
    clubId: string;
    email: string;
    role: OperatorRole;
    delivery: InviteDelivery;
  },
) {
  const { data, error } = await admin.rpc("apply_club_operator_invite", {
    p_actor_id: input.actorId,
    p_club_id: input.clubId,
    p_auth_user_id: input.delivery.user.id,
    p_email_normalized: input.email,
    p_operator_role: input.role,
    p_invitation_sent: input.delivery.sent,
    p_delivery_outcome: input.delivery.deliveryOutcome,
  }).single();
  if (error || !data?.invite_id) throw new Error("ATOMIC_INVITE_FAILED");
  return data as { invite_id: string; outcome: string; invite_status: string };
}
export async function revokeInvite(
  admin: SupabaseAdmin,
  actorId: string,
  inviteId: string,
) {
  const { data, error } = await admin.rpc("revoke_club_operator_invite", {
    p_actor_id: actorId,
    p_invite_id: inviteId,
  }).single();
  if (error || !data?.invite_id) throw new Error("ATOMIC_REVOKE_FAILED");
  return data as { invite_id: string; outcome: string; invite_status: string };
}

export async function handleOpsClubAccounts(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const auth = await authenticateUser(req);
  if (auth instanceof Response) return auth;
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  try {
    const body = await req.json().catch(() => null) as
      | InviteRequest
      | RevokeRequest
      | null;
    if (!body || typeof body !== "object") {
      return json({ error: "INVALID_REQUEST" }, 400);
    }
    if (body.action === "invite") {
      const email = normalizeEmail(body.email);
      if (!isUuid(body.club_id) ||
        !isEnabledOperatorRole(body.operator_role, Deno.env.get("OPS_DEALER_CONTROL_INVITES_ENABLED")) ||
        !email) {
        return json({ error: "INVALID_REQUEST" }, 400);
      }
      if (!(await isOwner(admin, body.club_id, auth.uid))) {
        return json({ error: "FORBIDDEN" }, 403);
      }
      const redirectTo = inviteRedirectTo();
      if (!redirectTo) {
        return json({ error: "INVITE_CONFIGURATION_REQUIRED" }, 503);
      }
      const delivery = await resolveInviteDelivery(admin, email, redirectTo);
      const result = await applyInvite(admin, {
        actorId: auth.uid,
        clubId: body.club_id,
        email,
        role: body.operator_role,
        delivery,
      });
      return json({
        status: result.outcome,
        invite_id: result.invite_id,
        invite_status: result.invite_status,
      });
    }
    if (body.action === "revoke") {
      if (!isUuid(body.invite_id)) {
        return json({ error: "INVALID_REQUEST" }, 400);
      }
      const result = await revokeInvite(admin, auth.uid, body.invite_id);
      return json({
        status: result.outcome,
        invite_id: result.invite_id,
        invite_status: result.invite_status,
      });
    }
    return json({ error: "INVALID_REQUEST" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "INTERNAL_ERROR";
    const status = message === "INVITE_DELIVERY_FAILED" ||
        message === "INVITE_RESEND_ID_MISMATCH"
      ? 502
      : 500;
    return json({
      error: [
          "AUTH_LOOKUP_LIMIT",
          "AUTH_LOOKUP_FAILED",
          "INVITE_DELIVERY_FAILED",
          "INVITE_RESEND_ID_MISMATCH",
          "ATOMIC_INVITE_FAILED",
          "ATOMIC_REVOKE_FAILED",
        ].includes(message)
        ? message
        : "INTERNAL_ERROR",
    }, status);
  }
}

if (import.meta.main) Deno.serve(handleOpsClubAccounts);
