import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { FnbOrder, FnbOrderItem } from "./useFnbOrders";
import { useAuth } from "./useAuth";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";

/**
 * Live Kitchen board (F6). PAID-but-not-yet-shipped orders for a club, FIFO by `paid_at`, kept fresh
 * by Supabase Realtime on `fnb_orders` + `fnb_order_items` (published with REPLICA IDENTITY FULL in
 * migration …0005) with a 30s poll fallback when the channel drops. When the kitchen ships every line
 * of an order, `fnb_mark_shipped` flips it to `status='shipped'` server-side → the realtime UPDATE
 * drops it off this board (no longer matches `status='paid'`). RLS-scoped direct reads; `fnb_*`
 * untyped → `supabase as any`. Mirrors the two-read + client-side grouping of `useFnbOrders`.
 */
export function useFnbKitchen(clubId: string | undefined) {
  const {user,session,loading:authLoading}=useAuth();
  const actor=authLoading?undefined:user?.id;
  const epoch=sessionReadEpoch(session);
  const qc = useQueryClient();
  const queryKey = ["fnb", "kitchen", clubId, actor, epoch];

  const query = useQuery({
    queryKey,
    enabled: !!actor && !!clubId,
    refetchInterval: 30000, // poll fallback (realtime is primary)
    queryFn: async (): Promise<FnbOrder[]> => {
      const sb = supabase as any;
      const { data: orders, error } = await sb.from("fnb_orders")
        .select("*").eq("club_id", clubId).eq("status", "paid")
        .order("paid_at", { ascending: true }).limit(100); // FIFO — oldest first
      if (error) throw error;
      if (!Array.isArray(orders)) throw new Error("Không xác minh được danh sách đơn.");
      const list = orders as FnbOrder[];
      if (list.length === 0) return [];
      const ids = list.map((o) => o.id);
      const { data: items, error: e2 } = await sb.from("fnb_order_items").select("*").in("order_id", ids);
      if (e2) throw e2;
      if (!Array.isArray(items)) throw new Error("Không xác minh được chi tiết đơn.");
      const byOrder: Record<string, FnbOrderItem[]> = {};
      for (const it of items as FnbOrderItem[]) (byOrder[it.order_id] ??= []).push(it);
      return list.map((o) => ({ ...o, items: byOrder[o.id] ?? [] }));
    },
  });

  // per-instance channel id so two boards never collide on the channel name
  const instanceId = useRef(Math.random().toString(36).slice(2, 8)).current;
  useEffect(() => {
    if (!actor || !clubId) return;
    const channel = supabase.channel(`fnb-kitchen:${clubId}:${instanceId}:${epoch}`);
    for (const table of ["fnb_orders", "fnb_order_items"]) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `club_id=eq.${clubId}` },
        () => { qc.invalidateQueries({ queryKey: ["fnb", "kitchen", clubId] }); },
      );
    }
    channel.subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [actor, clubId, instanceId, epoch, qc]);

  return query;
}
