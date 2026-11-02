import { useClubFinanceSummary } from "@/hooks/useClubFinanceSummary";
import { PAYROLL_STATUS_META } from "@/lib/clubFinance";
import { PayrollCostTab, type LivePayrollData } from "../tabs/PayrollCostTab";
import { financeBusinessToday } from "@/lib/financeSummaryRead";
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/**
 * W4 live wrapper — mounted ONLY when `accountingControlLivePayroll` is ON. Read-only; maps the
 * club finance summary's cost + per-period payroll into the real "Lương" view. Role split +
 * table-hour stay mock inside PayrollCostTab.
 */
export function LivePayrollTab() {
  const to = financeBusinessToday();
  const from = `${to.slice(0, 7)}-01`;
  const { loading, error, summary } = useClubFinanceSummary({ from, to, clubFilter: "all" });

  const data: LivePayrollData | null = summary
    ? {
        periodLabel: `Tháng này · ${dm(from)} → ${dm(to)}`,
        payrollNet: summary.cost.payrollNet,
        payrollGross: summary.cost.payrollGross,
        adjustments: summary.cost.adjustments,
        unpaidTotal: summary.unpaidTotal,
        reconciledTotal: summary.reconciledTotal,
        perPeriod: summary.perPeriod.map((p) => ({
          periodKey: p.periodKey,
          gross: p.gross,
          net: p.net,
          statusLabel: PAYROLL_STATUS_META[p.status].label,
          statusTone: PAYROLL_STATUS_META[p.status].tone,
        })),
      }
    : null;

  return <PayrollCostTab live={{ active: true, loading, error, data }} />;
}
