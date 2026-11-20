// deno test supabase/functions/ops-club-accounts/index.test.ts
import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseAdmin } from "../_shared/staking-common.ts";
import {
  applyInvite,
  findUserByEmail,
  inviteRedirectTo,
  isEnabledOperatorRole,
  resolveInviteDelivery,
} from "./index.ts";

Deno.test("Dealer Control invitations require the exact server flag", () => {
  assertEquals(isEnabledOperatorRole("dealer_control"), false);
  assertEquals(isEnabledOperatorRole("dealer_control", "TRUE"), false);
  assertEquals(isEnabledOperatorRole("dealer_control", "true"), true);
  assertEquals(isEnabledOperatorRole("cashier"), true);
  assertEquals(isEnabledOperatorRole("floor"), true);
  assertEquals(isEnabledOperatorRole("owner", "true"), false);
});

function fakeAdmin(options: {
  users?: Array<
    { id: string; email: string; email_confirmed_at?: string | null }
  >;
  inviteUser?: { id: string; error?: string };
  listUsersError?: string;
  rpc?: {
    invite_id?: string;
    outcome?: string;
    invite_status?: string;
    error?: string;
  };
}): SupabaseAdmin {
  return {
    auth: {
      admin: {
        listUsers: async () => ({
          data: { users: options.users ?? [] },
          error: options.listUsersError
            ? { message: options.listUsersError }
            : null,
        }),
        inviteUserByEmail: async () =>
          options.inviteUser?.error
            ? ({
              data: { user: null },
              error: { message: options.inviteUser.error },
            })
            : ({
              data: { user: { id: options.inviteUser?.id ?? "new-user" } },
              error: null,
            }),
      },
    },
    rpc: () => ({
      single: async () =>
        options.rpc?.error
          ? ({ data: null, error: { message: options.rpc.error } })
          : ({
            data: {
              invite_id: options.rpc?.invite_id ?? "invite",
              outcome: options.rpc?.outcome ?? "INVITED",
              invite_status: options.rpc?.invite_status ?? "pending",
            },
            error: null,
          }),
    }),
  } as unknown as SupabaseAdmin;
}

Deno.test("new user is invited; confirmed user is granted without a delivery", async () => {
  const invited = await resolveInviteDelivery(
    fakeAdmin({ inviteUser: { id: "new-user" } }),
    "floor@example.com",
    "https://ops.example.com/ops/auth/callback",
  );
  assertEquals(invited.sent, true);
  assertEquals(invited.deliveryOutcome, "sent");
  const confirmed = await resolveInviteDelivery(
    fakeAdmin({
      users: [{
        id: "known",
        email: "floor@example.com",
        email_confirmed_at: "2026-01-01T00:00:00Z",
      }],
    }),
    "floor@example.com",
    "https://ops.example.com/ops/auth/callback",
  );
  assertEquals(confirmed.sent, false);
  assertEquals(confirmed.deliveryOutcome, "not_required");
});

Deno.test("unconfirmed user attempts a fail-closed resend", async () => {
  const resent = await resolveInviteDelivery(
    fakeAdmin({
      users: [{
        id: "pending",
        email: "floor@example.com",
        email_confirmed_at: null,
      }],
      inviteUser: { id: "pending" },
    }),
    "floor@example.com",
    "https://ops.example.com/ops/auth/callback",
  );
  assertEquals(resent.deliveryOutcome, "resent");
  await assertRejects(
    () =>
      resolveInviteDelivery(
        fakeAdmin({
          users: [{
            id: "pending",
            email: "floor@example.com",
            email_confirmed_at: null,
          }],
          inviteUser: { id: "pending", error: "delivery failed" },
        }),
        "floor@example.com",
        "https://ops.example.com/ops/auth/callback",
      ),
    Error,
    "INVITE_DELIVERY_FAILED",
  );
});

Deno.test("atomic RPC errors fail without reporting a grant", async () => {
  await assertRejects(
    () =>
      applyInvite(fakeAdmin({ rpc: { error: "rollback" } }), {
        actorId: "actor",
        clubId: "club",
        email: "floor@example.com",
        role: "floor",
        delivery: {
          user: { id: "target" },
          sent: true,
          deliveryOutcome: "sent",
        },
      }),
    Error,
    "ATOMIC_INVITE_FAILED",
  );
});

Deno.test("redirect must match the exact configured HTTPS Ops origin", () => {
  const env = {
    get: (key: string) =>
      ({
        OPS_INVITE_REDIRECT_TO: "https://ops.example.com/ops/auth/callback",
        OPS_INVITE_EXPECTED_ORIGIN: "https://ops.example.com/",
      })[key],
  } as unknown as Deno.Env;
  assertEquals(
    inviteRedirectTo(env),
    "https://ops.example.com/ops/auth/callback",
  );
  const wrong = {
    get: (key: string) =>
      ({
        OPS_INVITE_REDIRECT_TO: "https://other.example.com/ops/auth/callback",
        OPS_INVITE_EXPECTED_ORIGIN: "https://ops.example.com/",
      })[key],
  } as unknown as Deno.Env;
  assertEquals(inviteRedirectTo(wrong), null);
});

Deno.test("Auth lookup fails closed on pagination errors", async () => {
  await assertRejects(
    () =>
      findUserByEmail(
        fakeAdmin({ listUsersError: "unavailable" }),
        "floor@example.com",
      ),
    Error,
    "AUTH_LOOKUP_FAILED",
  );
});

Deno.test("resend rejects a mismatched Auth identity instead of granting either account", async () => {
  await assertRejects(
    () =>
      resolveInviteDelivery(
        fakeAdmin({
          users: [{
            id: "expected",
            email: "floor@example.com",
            email_confirmed_at: null,
          }],
          inviteUser: { id: "different" },
        }),
        "floor@example.com",
        "https://ops.example.com/ops/auth/callback",
      ),
    Error,
    "INVITE_RESEND_ID_MISMATCH",
  );
});
