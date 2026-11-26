import { useEffect, useState } from "react";
import { z } from "zod";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { startLiveReportRefresh } from "@/lib/liveReportRefresh";
import { observeTrackerContextRead } from "@/lib/tournament/observeTrackerContextRead";
import type { FinanceRange } from "./financeReadAdapter";
import {FEATURES} from '@/lib/featureFlags';

const amount = z.number().refine(Number.isSafeInteger);
const cashflow = z.object({
  ok: z.literal(true),
  club_id: z.string(),
  from: z.string(),
  to: z.string(),
  cash_flow: z.object({ cash_in: amount, cash_out: amount, prize_cash_out: amount.optional(), dealer_pt_cash_out: amount.refine(value=>value>=0).optional(), club_expense_cash_out: amount.refine(value=>value>=0).optional(), bank_in: amount, bank_out: amount, unallocated_bank: amount }),
  unmatched_verified_bank: amount,
  entry_allocation: z.object({ prize_delta: amount, fees_delta: amount, unclassified_entries: z.number().int().nonnegative() }),
  closed_shift_variance: amount,
  drawer_adjustments: amount,
});
type Cashflow = z.infer<typeof cashflow>;
const money = (value: number) => `${new Intl.NumberFormat("vi-VN").format(value)} VND`;

export default function CashierCashflowPanel({ clubId, range }: { clubId: string; range: FinanceRange }) {
  const client = useSupabaseClient();
  const [state, setState] = useState<{ data: Cashflow | null; error: string | null }>({ data: null, error: null });
  useEffect(() => {
    let active = true;
    setState({ data: null, error: null });
    const load = async () => {
      try {
        const { data, error } = await observeTrackerContextRead(client.rpc("cashier_cashflow_range_v1" as never, {
          p_club_id: clubId, p_from: range.from, p_to: range.to,
        } as never));
        if (error) throw error;
        const result = cashflow.parse(data);
        if (result.club_id !== clubId || Date.parse(result.from) !== Date.parse(range.from)
          || Date.parse(result.to) !== Date.parse(range.to)) throw new Error("CASHFLOW_SCOPE_MISMATCH");
        if (active) setState({ data: result, error: null });
      } catch {
        if (active) setState({ data: null, error: "Không tải được sổ dòng tiền Cashier V1." });
      }
    };
    const stop = startLiveReportRefresh(load, FEATURES.clubExpenseCashSource?5_000:30_000);
    return () => { active = false; stop(); };
  }, [client, clubId, range.from, range.to]);

  return <section className="mt-5 rounded-2xl border border-emerald-300/20 bg-[#07100c] p-4 sm:p-5">
    <h2 className="font-semibold text-white">Dòng tiền Cashier V1 · sổ giao dịch đã ghi nhận</h2>
    <p className="mt-1 text-xs text-[#9fb1a6]">Theo thời điểm giao dịch/đóng ca thực tế. Không cộng các số này thêm lần nữa vào tổng P&amp;L phía trên; dữ liệu cũ chưa được đối chiếu chuyển đổi.</p>
    {state.error ? <p role="alert" className="mt-3 text-sm text-amber-200">{state.error}</p>
      : !state.data ? <p className="mt-3 text-sm text-[#9fb1a6]">Đang tải sổ Cashier…</p>
        : <>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <Cell label="Tiền mặt nhận" value={money(state.data.cash_flow.cash_in)} />
            <Cell label="Tiền mặt hoàn" value={money(state.data.cash_flow.cash_out)} />
            {state.data.cash_flow.prize_cash_out !== undefined && (
              <Cell label="Thưởng đã chi từ két" value={money(state.data.cash_flow.prize_cash_out)} />
            )}
            {state.data.cash_flow.dealer_pt_cash_out !== undefined && (
              <Cell label="Lương dealer PT có chứng từ chi từ két" value={money(state.data.cash_flow.dealer_pt_cash_out)} />
            )}
            {state.data.cash_flow.club_expense_cash_out !== undefined && (
              <Cell label="Chi phí có chứng từ chi từ két" value={money(state.data.cash_flow.club_expense_cash_out)} />
            )}
            <Cell label="Ngân hàng nhận" value={money(state.data.cash_flow.bank_in)} />
            <Cell label="Ngân hàng hoàn đã ghi" value={money(state.data.cash_flow.bank_out)} />
            <Cell label="Khoản thừa chưa phân bổ" value={money(state.data.cash_flow.unallocated_bank)} />
            <Cell label="SePay xác minh chưa ghép" value={money(state.data.unmatched_verified_bank)} />
            <Cell label="Biến động quỹ thưởng" value={money(state.data.entry_allocation.prize_delta)} />
            <Cell label="Phí theo giá đã chốt" value={money(state.data.entry_allocation.fees_delta)} />
            <Cell label="Chênh lệch két đã chốt" value={money(state.data.closed_shift_variance)} />
            <Cell label="Điều chỉnh két ghi bổ sung" value={money(state.data.drawer_adjustments)} />
          </div>
          {state.data.entry_allocation.unclassified_entries > 0 && <p className="mt-3 text-xs text-amber-200">
            {state.data.entry_allocation.unclassified_entries} lượt cũ thiếu chi tiết giá đã lưu; không phân bổ phí bằng giá tour hiện tại.
          </p>}
        </>}
  </section>;
}

function Cell({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-white/10 p-3"><span className="text-xs text-[#9fb1a6]">{label}</span>
    <strong className="mt-1 block font-mono text-sm text-white">{value}</strong></div>;
}
