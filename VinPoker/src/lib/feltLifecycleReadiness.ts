import { supabase } from "@/integrations/supabase/client";
import type { CloseReportTotals } from "@/lib/closeReport";

export interface CloseReadiness {
  ok: boolean;
  ready: boolean;
  alreadyClosed: boolean;
  blockers: string[];
  error?: string;
}

export interface TournamentCloseReadiness extends CloseReadiness {
  entryCount: number;
  buyInTotal: number;
  cashInTotal: number;
  prizeTotal: number;
  clubRevenue: number;
  cashierBalance: number;
  reconcileDelta: number;
  reconciled: boolean;
}

const blockerLabels: Record<string, string> = {
  table_club_mismatch: "Bàn thuộc club khác",
  open_table_session: "Còn phiên bàn đang mở",
  active_tournament_table: "Còn bàn giải đang hoạt động",
  active_seats: "Còn người chơi đang ngồi",
  active_hand: "Còn hand chưa kết thúc",
  pending_move: "Còn lệnh chuyển ghế đang chờ Tracker",
  active_dealer_assignment: "Còn Dealer chưa được giải phóng",
  legacy_dealer_assignment: "Có assignment Dealer cũ chưa rõ phiên bàn",
};

export function describeCloseBlockers(blockers: readonly string[]): string {
  return blockers.map((code) => blockerLabels[code] ?? `Trạng thái cần kiểm tra: ${code}`).join("; ");
}

export function withServerCloseTotals(
  computed: CloseReportTotals, server: TournamentCloseReadiness,
): CloseReportTotals {
  return {
    ...computed,
    entryCount: server.entryCount,
    buyInTotal: server.buyInTotal,
    cashInTotal: server.cashInTotal,
    prizeTotal: server.prizeTotal,
    cashOutTotal: server.prizeTotal,
    clubRevenue: server.clubRevenue,
    cashierBalance: server.cashierBalance,
    reconcileDelta: server.reconcileDelta,
    reconciled: server.reconciled,
    overlay: Math.max(0, server.prizeTotal - server.buyInTotal),
    surplusToPool: Math.max(0, server.buyInTotal - server.prizeTotal),
  };
}

function parseBase(value: unknown): CloseReadiness {
  if (!value || typeof value !== "object") throw new Error("Phản hồi kiểm tra đóng không hợp lệ.");
  const row = value as Record<string, unknown>;
  if (row.ok !== true) {
    return { ok: false, ready: false, alreadyClosed: false, blockers: [],
      error: typeof row.error === "string" ? row.error : "readiness_failed" };
  }
  if (typeof row.ready !== "boolean" || typeof row.already_closed !== "boolean"
      || !Array.isArray(row.blockers) || !row.blockers.every((item) => typeof item === "string")) {
    throw new Error("Phản hồi kiểm tra đóng không hợp lệ.");
  }
  return { ok: true, ready: row.ready, alreadyClosed: row.already_closed,
    blockers: row.blockers as string[] };
}

export async function getDealerTourCloseReadiness(tourId: string, clubId: string): Promise<CloseReadiness> {
  const rpc = supabase.rpc as unknown as (
    name: string, args: Record<string, string>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpc.call(supabase, "get_dealer_tour_close_readiness_v1", {
    p_tour_id: tourId, p_club_id: clubId,
  });
  if (error) throw new Error(`Không kiểm tra được phiên bàn: ${error.message}`);
  return parseBase(data);
}

export async function getTournamentCloseReadiness(tournamentId: string): Promise<TournamentCloseReadiness> {
  const rpc = supabase.rpc as unknown as (
    name: string, args: Record<string, string>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpc.call(supabase, "get_tournament_close_readiness_v1", {
    p_tournament_id: tournamentId,
  });
  if (error) throw new Error(`Không kiểm tra được trạng thái giải: ${error.message}`);
  const base = parseBase(data);
  if (!base.ok) return { ...base, entryCount: 0, buyInTotal: 0, cashInTotal: 0,
    prizeTotal: 0, clubRevenue: 0, cashierBalance: 0, reconcileDelta: 0, reconciled: false };
  const row = data as Record<string, unknown>;
  const numeric = ["entry_count", "buy_in_total", "cash_in_total", "prize_total",
    "club_revenue", "cashier_balance", "reconcile_delta"] as const;
  if (numeric.some((key) =>
    (typeof row[key] !== "number" && typeof row[key] !== "string")
    || (typeof row[key] === "string" && !/^-?\d+$/.test(row[key]))
    || !Number.isSafeInteger(Number(row[key])))
      || typeof row.reconciled !== "boolean") {
    throw new Error("Bản xem trước chốt giải từ server không hợp lệ.");
  }
  return {
    ...base, entryCount: Number(row.entry_count), buyInTotal: Number(row.buy_in_total),
    cashInTotal: Number(row.cash_in_total), prizeTotal: Number(row.prize_total),
    clubRevenue: Number(row.club_revenue), cashierBalance: Number(row.cashier_balance),
    reconcileDelta: Number(row.reconcile_delta), reconciled: row.reconciled,
  };
}
