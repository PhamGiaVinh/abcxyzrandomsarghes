import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";

export type FnbOrderStatus = "pending" | "paid" | "shipped" | "cancelled" | "expired";

export type FnbOrderItem = {
  id: string; order_id: string; menu_item_id: string; name_snapshot: string;
  qty: number; unit_price_snapshot: number; line_status: FnbOrderStatus;
};
export type FnbOrder = {
  id: string; club_id: string; status: FnbOrderStatus; source: string;
  table_label: string | null; customer_name: string | null; note: string | null;
  subtotal_vnd: number; cogs_vnd: number;
  created_at: string; paid_at: string | null;
  // A2 — soft links (reporting-only); undefined until migration 20261111000014 is applied live.
  table_ref?: string | null; player_ref?: string | null;
  // GQR — guest QR ordering; undefined until 20261111000017 applied.
  guest_seat?: number | null; payment_method?: string | null;
  items: FnbOrderItem[];
};

/**
 * Counter order list (RLS-scoped direct reads — no RPC). Two reads (orders in `statuses` + their
 * items) grouped client-side. Light 15s poll so the pending/paid tabs stay fresh without realtime
 * (the live Kitchen Display gets realtime in F6). Counter mutations invalidate
 * `['fnb','orders',clubId]`. `fnb_*` is untyped → `supabase as any`.
 */
export function useFnbOrders(clubId: string | undefined, statuses: FnbOrderStatus[]) {
  const {user,session,loading:authLoading}=useAuth();
  const actor=authLoading?undefined:user?.id;
  const epoch=sessionReadEpoch(session);
  return useQuery({
    queryKey: ["fnb", "orders", clubId, statuses, actor, epoch],
    enabled: !!actor && !!clubId && statuses.length > 0,
    refetchInterval: 15000,
    queryFn: async (): Promise<FnbOrder[]> => {
      const sb = supabase as any;
      const { data: orders, error } = await sb.from("fnb_orders")
        .select("*").eq("club_id", clubId).in("status", statuses)
        .order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      if (!Array.isArray(orders)) throw new Error("Không xác minh được danh sách đơn.");
      const list = orders as FnbOrder[];
      if (list.length === 0) return [];
      const ids = list.map((o) => o.id);
      const { data: items, error: e2 } = await sb.from("fnb_order_items").select("*").in("order_id", ids);
      if (e2) throw e2;
      if (!Array.isArray(items)) throw new Error("Không xác minh được chi tiết đơn.");
      const byOrder: Record<string, FnbOrderItem[]> = {};
      for (const it of items as FnbOrderItem[]) {
        (byOrder[it.order_id] ??= []).push(it);
      }
      return list.map((o) => ({ ...o, items: byOrder[o.id] ?? [] }));
    },
  });
}
