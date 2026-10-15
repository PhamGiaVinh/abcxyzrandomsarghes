// Cashier lookup player by user_id (UUID from QR) — returns active deals + purchases
// Auth: super_admin OR cashier (scoped to their owned clubs)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

import { retryFetch } from "../_shared/retry.ts";
import { parseBody, z } from "../_shared/validate.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BodySchema = z.object({ user_id: z.string().uuid() });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }
    const token = authHeader.replace("Bearer ", "");

    const supaUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader }, fetch: retryFetch } }
    );
    const { data: userData, error: claimsErr } = await supaUser.auth.getUser(token);
    if (claimsErr) {
      const unavailable = claimsErr.status === 0 || (claimsErr.status ?? 0) >= 500;
      return json({ error: unavailable ? "Authentication unavailable" : "Unauthorized" }, unavailable ? 503 : 401);
    }
    if (!userData?.user?.id) return json({ error: "Unauthorized" }, 401);
    const callerId = userData.user.id;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Role check
    const { data: roles, error: roleError } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId);
    if (roleError || !Array.isArray(roles)) return json({ error: "Role lookup unavailable" }, 500);
    const roleSet = new Set((roles ?? []).map((r: any) => r.role as string));
    const isSuper = roleSet.has("super_admin");
    const isCashier = roleSet.has("cashier");
    if (!isSuper && !isCashier) return json({ error: "Forbidden" }, 403);

    const parsed = await parseBody(req, BodySchema, corsHeaders);
    if (!parsed.ok) return parsed.response;
    const userId = parsed.data.user_id.toLowerCase();

    // Cashier scope: only assigned clubs (club_cashiers + owner fallback)
    let clubIdScope: Set<string> | null = null;
    if (!isSuper) {
      const { data: clubIds, error: scopeError } = await admin.rpc("cashier_club_ids", { _user_id: callerId });
      if (scopeError || !Array.isArray(clubIds)) return json({ error: "Cashier scope unavailable" }, 500);
      clubIdScope = new Set(((clubIds ?? []) as any[]).map((r: any) => (typeof r === "string" ? r : r.cashier_club_ids ?? r)).filter(Boolean));
      if (clubIdScope.size === 0) {
        return json({ player: null, deals: [], message: "Cashier chưa được gán CLB nào" });
      }
    }

    // Active deals where player is the player
    const ACTIVE = ["listing", "committing", "committed", "funded"];
    let dealQuery = admin
      .from("staking_deals")
      .select("id, custom_event_name, tournament_id, buy_in_amount_vnd, percentage_sold, filled_percent, status, club_id, created_at, player_checked_in, player_checkin_at, early_closed, platform_fixed_fee")
      .eq("player_id", userId)
      .in("status", ACTIVE)
      .order("created_at", { ascending: false })
      .limit(30);
    if (clubIdScope) dealQuery = dealQuery.in("club_id", Array.from(clubIdScope));
    const { data: deals, error: dealError } = await dealQuery;
    if (dealError || !Array.isArray(deals)) return json({ error: "Deal lookup unavailable" }, 500);
    const dealList = (deals ?? []) as any[];

    // A cashier's membership in one club is not authority over every player's
    // private contact/bank profile. Establish an active deal in the caller's
    // exact club scope before even fetching those fields. Superadmin is global.
    if (!isSuper && dealList.length === 0) {
      return json({ player: null, deals: [], message: "Không có deal đang hoạt động trong phạm vi CLB" });
    }
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("user_id, display_name, phone, avatar_url, bank_name, bank_account_number, bank_account_holder")
      .eq("user_id", userId)
      .maybeSingle();
    if (profileError) return json({ error: "Player lookup unavailable" }, 500);
    if (!profile) return json({ player: null, deals: [], message: "Không tìm thấy người chơi" });

    let purchases: any[] = [];
    if (dealList.length > 0) {
      const dealIds = dealList.map((d) => d.id);
      const { data: purs, error: purchaseError } = await admin
        .from("staking_purchases")
        .select("id, deal_id, backer_id, percent, amount_vnd, status, reference_code, committed_at, funded_at")
        .in("deal_id", dealIds)
        .in("status", ["committed", "funded"])
        .limit(500);
      if (purchaseError || !Array.isArray(purs)) return json({ error: "Purchase lookup unavailable" }, 500);
      purchases = purs ?? [];

      // backer names
      const backerIds = Array.from(new Set(purchases.map((p) => p.backer_id))).filter(Boolean);
      let nameMap = new Map<string, string>();
      if (backerIds.length > 0) {
        const { data: backers, error: backerError } = await admin
          .from("profiles")
          .select("user_id, display_name")
          .in("user_id", backerIds);
        if (backerError || !Array.isArray(backers)) return json({ error: "Backer lookup unavailable" }, 500);
        nameMap = new Map((backers ?? []).map((b: any) => [b.user_id, b.display_name ?? "—"]));
      }
      purchases = purchases.map((p) => ({ ...p, backer_name: nameMap.get(p.backer_id) ?? "—" }));
    }

    const result = dealList.map((d) => {
      const dealPurchases = purchases.filter((p) => p.deal_id === d.id);
      const sumFundedVnd = dealPurchases
        .filter((p) => p.status === "funded")
        .reduce((s, p) => s + Number(p.amount_vnd || 0), 0);
      const remainingPercent = Math.max(0, Number(d.percentage_sold) - Number(d.filled_percent));
      const remainingVnd = Math.round(
        (Number(d.buy_in_amount_vnd) * remainingPercent) / 100
      );
      return {
        deal_id: d.id,
        title: d.custom_event_name ?? `Deal #${String(d.id).slice(0, 6)}`,
        buy_in_vnd: d.buy_in_amount_vnd,
        sold_percent: d.percentage_sold,
        filled_percent: d.filled_percent,
        sum_funded_vnd: sumFundedVnd,
        remaining_percent: remainingPercent,
        remaining_vnd: remainingVnd,
        status: d.status,
        club_id: d.club_id,
        player_checked_in: !!d.player_checked_in,
        player_checkin_at: d.player_checkin_at,
        early_closed: !!d.early_closed,
        platform_fixed_fee: Number(d.platform_fixed_fee ?? 49000),
        purchases: dealPurchases
          .sort((a, b) => (a.committed_at < b.committed_at ? -1 : 1))
          .map((p) => ({
            id: p.id,
            percent: p.percent,
            amount_vnd: p.amount_vnd,
            status: p.status,
            reference_code: p.reference_code,
            backer_name: p.backer_name,
          })),
      };
    });

    return json({
      player: {
        id: profile.user_id,
        display_name: profile.display_name,
        phone: profile.phone,
        avatar_url: profile.avatar_url,
        bank_name: profile.bank_name,
        bank_account_number: profile.bank_account_number,
        bank_account_holder: profile.bank_account_holder,
      },
      deals: result,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
