import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

import {
  describeCloseBlockers,
  getDealerTourCloseReadiness,
  getTournamentCloseReadiness,
  withServerCloseTotals,
} from "./feltLifecycleReadiness";
import { computeCloseReport } from "./closeReport";

describe("server-sourced close readiness", () => {
  beforeEach(() => { rpc.mockReset(); });

  it.each(['dealer','tournament'] as const)('preserves the real client receiver for %s readiness reads',async(kind)=>{
    rpc.mockImplementation(function(this:{rpc:unknown}|undefined){
      if(this?.rpc!==rpc) throw new Error('Supabase RPC receiver lost');
      return Promise.resolve({data:{ok:true,ready:false,already_closed:false,blockers:['active_hand'],
        entry_count:0,buy_in_total:0,cash_in_total:0,prize_total:0,club_revenue:0,cashier_balance:0,
        reconcile_delta:0,reconciled:false},error:null});
    });
    const result=kind==='dealer'?await getDealerTourCloseReadiness('tour-test','club-test')
      :await getTournamentCloseReadiness('tour-test');
    expect(result).toMatchObject({ready:false,blockers:['active_hand']});
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("renders operational blockers in Vietnamese without inventing client authority", () => {
    expect(describeCloseBlockers(["active_hand", "pending_move"]))
      .toBe("Còn hand chưa kết thúc; Còn lệnh chuyển ghế đang chờ Tracker");
  });

  it("keeps a tour blocked while a Floor session is open", async () => {
    rpc.mockResolvedValue({ data: {
      ok: true, ready: false, already_closed: false, blockers: ["open_table_session"],
    }, error: null });
    await expect(getDealerTourCloseReadiness("tour", "club")).resolves.toMatchObject({
      ready: false, blockers: ["open_table_session"],
    });
    expect(rpc).toHaveBeenCalledWith("get_dealer_tour_close_readiness_v1", {
      p_tour_id: "tour", p_club_id: "club",
    });
  });

  it("takes money totals from the server, including negative club revenue", async () => {
    rpc.mockResolvedValue({ data: {
      ok: true, ready: true, already_closed: false, blockers: [],
      entry_count: 2, buy_in_total: 2_000_000, cash_in_total: 0,
      prize_total: 0, club_revenue: -2_000_000,
      cashier_balance: 0, reconcile_delta: 2_000_000, reconciled: false,
    }, error: null });
    const server = await getTournamentCloseReadiness("felt");
    expect(server).toMatchObject({
      ready: true, clubRevenue: -2_000_000, reconciled: false,
      reconcileDelta: 2_000_000,
    });
    const clientProjection = computeCloseReport({
      entries: [{ buyIn: 2_000_000, totalPay: 0, rakeCharged: 0, serviceCharged: 0,
        source: "offline", usedFreeRake: false }],
      payouts: [],
    });
    expect(clientProjection.clubRevenue).toBe(0);
    expect(withServerCloseTotals(clientProjection, server).clubRevenue).toBe(-2_000_000);
  });

  it("fails closed if the new server contract is absent or malformed", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "function not found" } });
    await expect(getDealerTourCloseReadiness("tour", "club")).rejects.toThrow("function not found");
    rpc.mockResolvedValueOnce({ data: { ok: true, ready: true, blockers: [] }, error: null });
    await expect(getDealerTourCloseReadiness("tour", "club")).rejects.toThrow("không hợp lệ");
    rpc.mockResolvedValueOnce({ data: {
      ok: true, ready: true, already_closed: false, blockers: [],
      entry_count: null, buy_in_total: 0, cash_in_total: 0, prize_total: 0,
      club_revenue: 0, cashier_balance: 0, reconcile_delta: 0, reconciled: true,
    }, error: null });
    await expect(getTournamentCloseReadiness("tour")).rejects.toThrow("không hợp lệ");
  });
});
