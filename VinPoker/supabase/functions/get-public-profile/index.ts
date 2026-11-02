import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const userId = url.searchParams.get("userId") ?? url.pathname.split("/").pop();
    if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) {
      return new Response(JSON.stringify({ error: "Invalid userId" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const replies =
      await Promise.all([
        supabase.from("profiles").select("user_id,display_name,avatar_url,bio,is_verified,rating_avg,total_deals,region")
          .eq("user_id", userId).maybeSingle(),
        supabase.from("staking_deals").select("id,status,result_prize_vnd,buy_in_amount_vnd,filled_percent,player_payout_vnd,completed_at")
          .eq("player_id", userId).order("completed_at", { ascending: false, nullsFirst: false }).limit(200),
        supabase.from("staking_purchases").select("id,deal_id,percent,amount_vnd,status")
          .eq("backer_id", userId).limit(500),
        supabase.from("deal_ratings").select("id,deal_id,rater_id,rating,comment,role,created_at")
          .eq("ratee_id", userId).order("created_at", { ascending: false }).limit(50),
      ]);
    if (replies.some(reply => reply.error)) throw new Error('PROFILE_DATA_UNAVAILABLE');
    const [{ data: profile }, { data: dealsAsPlayer }, { data: purchases }, { data: ratings }] = replies;
    if (![dealsAsPlayer, purchases, ratings].every(Array.isArray)) throw new Error('PROFILE_DATA_UNAVAILABLE');
    if (!profile) {
      return new Response(JSON.stringify({error: 'PROFILE_NOT_FOUND'}), {
        status: 404, headers: {...corsHeaders, 'Content-Type': 'application/json'},
      });
    }

    // Player stats
    const dealsCreated = (dealsAsPlayer ?? []).length;
    const completedDeals = (dealsAsPlayer ?? []).filter((d: any) => d.status === "completed");
    const dealsCompleted = completedDeals.length;
    const itmCount = completedDeals.filter((d: any) => (d.result_prize_vnd ?? 0) > 0).length;
    const totalProfit = completedDeals.reduce((s: number, d: any) => s + ((d.player_payout_vnd ?? 0) - (d.buy_in_amount_vnd ?? 0)), 0);
    const totalBuyIn = completedDeals.reduce((s: number, d: any) => s + (d.buy_in_amount_vnd ?? 0), 0);
    const avgRoi = totalBuyIn > 0 ? (totalProfit / totalBuyIn) * 100 : 0;

    // Backer stats
    const fundedPurchases = (purchases ?? []).filter((p: any) => p.status === "funded");
    const totalPurchases = (purchases ?? []).length;
    const totalStaked = fundedPurchases.reduce((s: number, p: any) => s + (p.amount_vnd ?? 0), 0);
    const activeCount = fundedPurchases.length;

    // Compute backer returns from completed deals
    let totalReturned = 0;
    if (fundedPurchases.length) {
      const dealIds = Array.from(new Set(fundedPurchases.map((p: any) => p.deal_id)));
      const { data: payoutDeals, error } = await supabase
        .from("staking_deals")
        .select("id,status,result_prize_vnd")
        .in("id", dealIds);
      if (error || !Array.isArray(payoutDeals)) throw new Error('PROFILE_DATA_UNAVAILABLE');
      const dMap = new Map<string, any>((payoutDeals ?? []).map((d: any) => [d.id, d]));
      for (const p of fundedPurchases) {
        const d = dMap.get(p.deal_id);
        if (d?.status === "completed" && d.result_prize_vnd) {
          totalReturned += Math.round((Number(d.result_prize_vnd) * Number(p.percent)) / 100);
        }
      }
    }
    const netPnl = totalReturned - totalStaked;

    // Rater names for display
    const raterIds = Array.from(new Set((ratings ?? []).map((r: any) => r.rater_id)));
    const { data: raters, error: ratersError } = raterIds.length
      ? await supabase.from("profiles").select("user_id,display_name,avatar_url").in("user_id", raterIds)
      : { data: [] as any[], error: null };
    if (ratersError || !Array.isArray(raters)) throw new Error('PROFILE_DATA_UNAVAILABLE');
    const raterMap = new Map((raters ?? []).map((r: any) => [r.user_id, r]));
    const ratingsWithNames = (ratings ?? []).map((r: any) => ({
      ...r, rater: raterMap.get(r.rater_id) ?? null,
    }));

    return new Response(JSON.stringify({
      profile,
      player: { dealsCreated, dealsCompleted, itmCount, totalProfit, avgRoi },
      backer: { totalPurchases, totalStaked, totalReturned, netPnl, activeCount },
      ratings: ratingsWithNames,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch {
    return new Response(JSON.stringify({ error: 'PROFILE_DATA_UNAVAILABLE' }), {
      status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
