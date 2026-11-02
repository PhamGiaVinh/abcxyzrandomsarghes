import { useClubFinanceSummary } from "@/hooks/useClubFinanceSummary";
import { OverviewTab, type LiveOverviewData } from "../tabs/OverviewTab";
import { financeBusinessToday } from "@/lib/financeSummaryRead";
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/**
 * W1 live wrapper — mounted ONLY when `accountingControlLiveOverview` is ON, so the
 * `get_club_finance_summary` fetch never runs while the flag is off. Read-only. Maps the
 * club summary (current month, RLS-scoped to the owner's club via clubFilter="all") into the
 * "Tiền của club" block; everything else stays mock inside OverviewTab.
 */
export function LiveOverviewTab({ onNavigate }: { onNavigate: (id: string) => void }) {
  const to = financeBusinessToday();
  const from = `${to.slice(0, 7)}-01`;
  const { loading, error, summary } = useClubFinanceSummary({ from, to, clubFilter: "all" });

  const data: LiveOverviewData | null = summary
    ? {
        periodLabel: `Tháng này · ${dm(from)} → ${dm(to)}`,
        retainedRevenue: summary.revenue.total,
        directCosts: summary.cost.payrollNet,
        contribution: summary.net,
      }
    : null;

  return <OverviewTab onNavigate={onNavigate} live={{ active: true, loading, error, data }} />;
}
