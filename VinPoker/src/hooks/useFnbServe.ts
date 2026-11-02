import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { FnbOrderItem } from "./useFnbOrders";
import { useAuth } from "./useAuth";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";

// ── GQR server surface (/fnb/serve) — the "phục vụ đến bàn thu tiền mặt" queue ─────────────────
// TABLE-source CASH orders still PENDING for the club, FIFO by created_at, kept fresh by realtime on
// fnb_orders/fnb_order_items (…0005 publication) with a 30s poll fallback (mirror of useFnbKitchen).
// The server marks one paid via fnb_mark_paid (M3 lets the server facet pay table+cash orders); the
// realtime UPDATE (status→paid) drops it off this queue. RLS-scoped reads; fnb_* untyped.

export type FnbServeOrder = {
  id: string; club_id: string; status: string; source: string;
  table_ref: string | null; guest_seat: number | null;
  customer_name: string | null; note: string | null;
  payment_method: string; subtotal_vnd: number; created_at: string;
  items: FnbOrderItem[];
};

export function useFnbServeQueue(clubId: string | undefined) {
  const {user,session,loading:authLoading}=useAuth();
  const actor=authLoading?undefined:user?.id;
  const epoch=sessionReadEpoch(session);
  const qc = useQueryClient();
  const queryKey = ["fnb", "serve", clubId, actor, epoch];

  const query = useQuery({
    queryKey,
    enabled: !!actor && !!clubId,
    refetchInterval: 30000, // poll fallback (realtime is primary)
    queryFn: async (): Promise<FnbServeOrder[]> => {
      const sb = supabase as any;
      const { data: orders, error } = await sb.from("fnb_orders")
        .select("*").eq("club_id", clubId)
        .eq("source", "table").eq("payment_method", "cash").eq("status", "pending")
        .order("created_at", { ascending: true }).limit(100); // FIFO — oldest first
      if (error) throw error;
      if (!Array.isArray(orders)) throw new Error("Không xác minh được danh sách đơn.");
      const list = orders as FnbServeOrder[];
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

  const instanceId = useRef(Math.random().toString(36).slice(2, 8)).current;
  useEffect(() => {
    if (!actor || !clubId) return;
    const channel = supabase.channel(`fnb-serve:${clubId}:${instanceId}:${epoch}`);
    for (const table of ["fnb_orders", "fnb_order_items"]) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `club_id=eq.${clubId}` },
        () => { qc.invalidateQueries({ queryKey: ["fnb", "serve", clubId] }); },
      );
    }
    channel.subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [actor, clubId, instanceId, epoch, qc]);

  return query;
}
