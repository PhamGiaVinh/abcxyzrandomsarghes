import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { FEATURES } from "@/lib/featureFlags";
import { useAuth } from "./useAuth";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";

export type FnbShiftRow = {
  id: string; club_id: string; status: "open" | "closed";
  opened_by: string | null; opened_at: string;
  closed_by: string | null; closed_at: string | null;
  opening_float_vnd: number;
  expected_cash_vnd: number | null; counted_cash_vnd: number | null; variance_vnd: number | null;
  note: string | null;
};
export type FnbShiftReportOrder = {
  id: string; at: string; kind: "sale" | "refund"; amount_vnd: number;
  is_comp: boolean; status: string; table_label: string | null; customer_name: string | null;
};
export type FnbShiftReport = {
  shift: FnbShiftRow;
  sales_vnd: number; refunds_vnd: number; expected_cash_vnd: number; expected_drawer_vnd: number;
  comp_count: number; orders: FnbShiftReportOrder[];
};

/**
 * A3 — the club's current open cash shift + recent (closed) shift history. RLS-scoped direct read of
 * fnb_cashier_shifts (SELECT-only for F&B staff/owner; writes go through the open/close RPCs). 15s
 * poll keeps the "expected so far" fresh while a shift is open. `fnb_*` is untyped → `supabase as any`.
 * `enabled` also gates on FEATURES.fnbShifts so nothing queries the table before the flag/backend is live.
 */
export function useFnbShifts(clubId: string | undefined) {
  const { user, session, loading: authLoading } = useAuth();
  const actor = authLoading ? undefined : user?.id;
  const epoch = sessionReadEpoch(session);
  return useQuery({
    queryKey: ["fnb", "shifts", clubId, actor, epoch],
    enabled: !!actor && !!clubId && FEATURES.fnbShifts,
    refetchInterval: 15000,
    queryFn: async (): Promise<{ open: FnbShiftRow | null; recent: FnbShiftRow[] }> => {
      const sb = supabase as any;
      const { data, error } = await sb.from("fnb_cashier_shifts")
        .select("*").eq("club_id", clubId)
        .order("opened_at", { ascending: false }).limit(20);
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error("Không xác minh được danh sách ca.");
      const rows = data as FnbShiftRow[];
      return { open: rows.find((r) => r.status === "open") ?? null, recent: rows };
    },
  });
}

/**
 * A3 — live report for one shift via fnb_get_shift_report. For an OPEN shift the totals are "so far"
 * (window end = now()); for a CLOSED shift they equal the frozen figures. Use the top-level
 * `expected_cash_vnd`/`expected_drawer_vnd` for the live open view; the frozen `shift.*_vnd` columns
 * are the settled record.
 */
export function useFnbShiftReport(shiftId: string | null | undefined) {
  const { user, session, loading: authLoading } = useAuth();
  const actor = authLoading ? undefined : user?.id;
  const epoch = sessionReadEpoch(session);
  return useQuery({
    queryKey: ["fnb", "shiftReport", shiftId, actor, epoch],
    enabled: !!actor && !!shiftId && FEATURES.fnbShifts,
    refetchInterval: 15000,
    queryFn: async (): Promise<FnbShiftReport> => {
      const { data, error } = await (supabase.rpc as any)("fnb_get_shift_report", { p_shift_id: shiftId });
      if (error) throw error;
      const res = data as any;
      if (res?.error) throw new Error(res.error);
      if (!res || typeof res !== "object" || Array.isArray(res) || res.shift?.id !== shiftId
        || ![res.sales_vnd, res.refunds_vnd, res.expected_cash_vnd, res.expected_drawer_vnd, res.comp_count]
          .every((value) => typeof value === "number" && Number.isFinite(value)) || !Array.isArray(res.orders)) {
        throw new Error("Không xác minh được số liệu ca.");
      }
      return res as FnbShiftReport;
    },
  });
}
