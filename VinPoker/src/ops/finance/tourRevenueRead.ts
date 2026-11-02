import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type TourRevenue = {
  tournamentId: string; name: string; eventDay: string | null;
  registrationClosedAt: string | null; provisional: boolean;
  buyState?: "open" | "closed" | "terminal";
  paidBuys: number; waitingSeatBuys: number; uniquePlayers: number;
  refundedBuys: number; unavailableBuys: number;
  rake: number | null; serviceFee: number | null; platformFee: number | null; collected: number | null;
};
export type LiveTourRevenue = { clubId: string; asOf: string; tours: TourRevenue[] };
export type FinalTourRevenue = { status: string; canExport: boolean; snapshot: TourRevenue | null; capturedAt: string | null };
type Client = SupabaseClient<Database>;
const malformed = () => new Error("TOUR_REVENUE_MALFORMED");
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const count = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const timestamp = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));

// A hung read must release the panel's polling/export lock. A late response
// stays attached to this expired observation and cannot replace fresher data.
async function observeRevenueRead<T>(request: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(request),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("TOUR_REVENUE_READ_TIMEOUT")), 10_000);
      }),
    ]);
  } finally { clearTimeout(timer); }
}

export function parseTourRevenue(value: unknown): TourRevenue {
  if (!record(value) || typeof value.tournamentId !== "string" || !value.tournamentId
    || typeof value.name !== "string" || typeof value.provisional !== "boolean"
    || !(value.eventDay === null || typeof value.eventDay === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.eventDay))
    || !(value.registrationClosedAt === null || timestamp(value.registrationClosedAt))) throw malformed();
  if (value.provisional) {
    if (!["open", "closed", "terminal"].includes(String(value.buyState))
      || (value.buyState === "closed") !== (value.registrationClosedAt !== null)) throw malformed();
  } else if (value.buyState !== undefined && value.buyState !== "closed") throw malformed();
  for (const key of ["paidBuys", "waitingSeatBuys", "uniquePlayers", "refundedBuys", "unavailableBuys"]) {
    if (!count(value[key])) throw malformed();
  }
  for (const key of ["rake", "serviceFee", "platformFee", "collected"]) {
    if (value.unavailableBuys === 0 ? !count(value[key]) : value[key] !== null) throw malformed();
  }
  return value as TourRevenue;
}

export async function loadLiveTourRevenue(client: Client, clubId: string): Promise<LiveTourRevenue> {
  const { data, error } = await observeRevenueRead(client.rpc("get_owner_tour_rake_live_v1" as never, { p_club_id: clubId } as never));
  if (error) throw new Error("TOUR_REVENUE_UNAVAILABLE");
  const value: unknown = data;
  if (!record(value) || value.clubId !== clubId || !timestamp(value.asOf) || !Array.isArray(value.tours)) throw malformed();
  const tours = value.tours.map(parseTourRevenue);
  if (new Set(tours.map(t => t.tournamentId)).size !== tours.length || tours.some(t => !t.provisional)) throw malformed();
  return { clubId, asOf: value.asOf, tours };
}

export async function loadFinalTourRevenue(client: Client, tournamentId: string): Promise<FinalTourRevenue> {
  const { data, error } = await observeRevenueRead(client.rpc("get_tour_revenue_buy_close_v1" as never, { p_tournament_id: tournamentId } as never));
  if (error) throw new Error("TOUR_REVENUE_FINAL_UNAVAILABLE");
  const value: unknown = data;
  if (!record(value) || typeof value.status !== "string" || typeof value.canExport !== "boolean") throw malformed();
  if (!value.canExport) {
    if (!["buy_open", "snapshot_missing", "closure_changed", "unavailable"].includes(value.status)) throw malformed();
    return { status: value.status, canExport: false, snapshot: null, capturedAt: null };
  }
  const snapshot = parseTourRevenue(value.snapshot);
  if (value.status !== "final" || snapshot.tournamentId !== tournamentId || snapshot.provisional
    || snapshot.unavailableBuys !== 0 || !snapshot.eventDay || !timestamp(value.capturedAt)
    || !timestamp(value.registrationClosedAt) || snapshot.registrationClosedAt !== value.registrationClosedAt) throw malformed();
  return { status: "final", canExport: true, snapshot, capturedAt: value.capturedAt };
}

export function finalTourRevenueCsv(report: FinalTourRevenue): string {
  if (!report.canExport || !report.snapshot || !report.capturedAt) throw new Error("TOUR_REVENUE_NOT_FINAL");
  const t = report.snapshot;
  // Quote every cell and neutralize spreadsheet formulas in editable tour names.
  const cell = (value: unknown) => `"${String(value ?? "").replace(/^(?:\s*[=+@\-]|[\t\r\n])/, "'$&").replace(/"/g, '""')}"`;
  return "\uFEFF" + [
    ["Tour ID", "Tên giải", "Ngày giải", "Đóng buy", "Ghi nhận snapshot", "Buy đã thu", "Người chơi duy nhất", "Rake VND", "Phí dịch vụ VND", "Phí nền tảng VND", "Tổng đã thu VND"],
    [t.tournamentId, t.name, t.eventDay, t.registrationClosedAt, report.capturedAt, t.paidBuys, t.uniquePlayers, t.rake, t.serviceFee, t.platformFee, t.collected],
  ].map(row => row.map(cell).join(",")).join("\r\n");
}
