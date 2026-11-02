import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";
import { observeTrackerContextRead } from "@/lib/tournament/observeTrackerContextRead";

export type FnbReportTopItem = { menuItemId: string; name: string; qty: number; revenue: number };
export type FnbReportLowStock = { ingredientId: string; name: string; onHand: number; threshold: number; unit: string };
export type FnbReportDailyPoint = { date: string; revenue: number; cogs: number };
export type FnbReportGroup = { tableRef?: string | null; playerRef?: string | null; name: string; revenue: number; cogs: number; count: number };

export type FnbReport = {
  revenue: number; cogs: number; grossProfit: number; orderCount: number;
  statusCounts: Record<string, number>;
  topItems: FnbReportTopItem[];
  lowStock: FnbReportLowStock[];
  dailyTrend: FnbReportDailyPoint[];
  compCount: number; compCogs: number;
  byTable: FnbReportGroup[];
  byPlayer: FnbReportGroup[];
};

function validReportRows(value: unknown, text: string[], numbers: string[], counts: string[] = []) {
  return Array.isArray(value) && value.every(row => row && typeof row === 'object' && !Array.isArray(row)
    && text.every(key => typeof row[key] === 'string')
    && numbers.every(key => typeof row[key] === 'number' && Number.isFinite(row[key]))
    && counts.every(key => Number.isSafeInteger(row[key]) && row[key] >= 0));
}

/**
 * F&B report (A2) — reads `fnb_get_report(p_from,p_to,p_club_id)`. `from`/`to` are ISO timestamptz
 * strings (caller picks the range). Comps are already excluded from `revenue`/`cogs`/`byTable`/
 * `byPlayer` — they surface separately via `compCount`/`compCogs`. `byTable`/`byPlayer` entries with a
 * null ref represent "Khách lẻ" (walk-in, no table/player picked).
 */
export function useFnbReport(clubId: string | undefined, from: string, to: string) {
  const { user, session, loading: authLoading } = useAuth();
  const actor = authLoading ? undefined : user?.id;
  const epoch = sessionReadEpoch(session);
  return useQuery({
    queryKey: ["fnb", "report", clubId, from, to, actor, epoch],
    enabled: !!actor && !!clubId,
    refetchInterval: 5_000,
    queryFn: async (): Promise<FnbReport> => {
      const { data, error } = await observeTrackerContextRead<{data: unknown; error: unknown}>((supabase.rpc as any)("fnb_get_report", {
        p_from: from, p_to: to, p_club_id: clubId,
      }));
      if (error) throw error;
      const report = data as Record<string, unknown> | null;
      if (!report || typeof report !== 'object' || Array.isArray(report)
        || !['revenue','cogs','grossProfit','orderCount','compCount','compCogs']
          .every(key => typeof report[key] === 'number' && Number.isFinite(report[key]))
        || !report.statusCounts || typeof report.statusCounts !== 'object' || Array.isArray(report.statusCounts)
        || !Object.values(report.statusCounts).every(value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
        || !['orderCount','compCount'].every(key => Number.isSafeInteger(report[key]) && Number(report[key]) >= 0)
        || !validReportRows(report.topItems, ['menuItemId','name'], ['qty','revenue'])
        || !validReportRows(report.lowStock, ['ingredientId','name','unit'], ['onHand','threshold'])
        || !validReportRows(report.dailyTrend, ['date'], ['revenue','cogs'])
        || !validReportRows(report.byTable, ['name'], ['revenue','cogs'], ['count'])
        || !validReportRows(report.byPlayer, ['name'], ['revenue','cogs'], ['count'])) {
        throw new Error('Không xác minh được số liệu báo cáo F&B.');
      }
      return data as FnbReport;
    },
  });
}
