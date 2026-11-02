import { useClubPayoutLiability } from "@/hooks/useClubPayoutLiability";
import { PayoutLiabilityTab, type LivePayoutData } from "../tabs/PayoutLiabilityTab";
import { Button } from "@/components/ui/button";
import { financeBusinessToday } from "@/lib/financeSummaryRead";
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/**
 * W3-B1 live wrapper — mounted ONLY when `accountingControlLivePayout` is ON. Read-only; maps
 * get_club_payout_liability into the tab's `live` prop. On 42883/42P01 (RPC not applied yet) the
 * hook reports notApplied → the tab degrades to "chưa áp dụng" + mock.
 */
export function LivePayoutTab() {
  const to = financeBusinessToday();
  const from = `${to.slice(0, 7)}-01`;
  const { loading, error, notApplied, data, reload } = useClubPayoutLiability({ from, to, clubFilter: "all" });

  const mapped: LivePayoutData | null = data
    ? {
        periodLabel: `Tháng này · ${dm(from)} → ${dm(to)}`,
        owedTotal: data.owedTotal,
        paidTotal: data.paidTotal,
        outstandingTotal: data.outstandingTotal,
        perTournament: data.perTournament,
        aging: data.aging,
      }
    : null;

  return <div className="space-y-2">
    <div className="flex justify-end"><Button size="sm" variant="outline" disabled={loading}
      onClick={() => { void reload(); }}>Tải lại phải-trả giải</Button></div>
    <PayoutLiabilityTab live={{ active: true, loading, error, notApplied, data: mapped }} />
  </div>;
}
