import { useMemo, useState } from "react";
import { financeCalendarInstants } from "@/lib/financeSummaryRead";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { SupabaseClientProvider } from "@/integrations/supabase/SupabaseClientContext";
import { AccountantFinanceTab } from "@/components/accountant/AccountantFinanceTab";
import CashierCashflowPanel from "@/ops/finance/CashierCashflowPanel";
import { currentMonthFinanceRange } from "@/ops/finance/financeReadAdapter";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Props {
  clubIds: string[];
  clubs: { id: string; name: string }[];
  dateRange?: { from: string; to: string };
  onClearDateRange?: () => void;
}

export default function RevenueReportTab({ clubIds, clubs, dateRange, onClearDateRange }: Props) {
  const { isClubOwner, isAdmin, isAccountant } = useAuth();
  const [selected, setSelected] = useState("");
  const [range, setRange] = useState(currentMonthFinanceRange);
  const effectiveRange = useMemo(() => {
    if (!dateRange) return range;
    try { return financeCalendarInstants(dateRange.from, dateRange.to); }
    catch { return null; }
  }, [dateRange, range]);
  const returnToMonth = () => {
    setRange(currentMonthFinanceRange());
    onClearDateRange?.();
  };
  const allowedClubs = clubs.filter(club => clubIds.includes(club.id));
  const clubId = allowedClubs.some(club => club.id === selected)
    ? selected : allowedClubs.length === 1 ? allowedClubs[0].id : null;
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Báo cáo quầy</h2>
        <Select value={clubId ?? ""} onValueChange={setSelected}>
          <SelectTrigger aria-label="CLB báo cáo" className="w-full sm:w-64">
            <SelectValue placeholder="Chọn CLB" />
          </SelectTrigger>
          <SelectContent>
            {allowedClubs.map(club => <SelectItem key={club.id} value={club.id}>{club.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {!effectiveRange ? <div role="alert" className="space-y-2"><p>Khoảng ngày báo cáo không hợp lệ. Vui lòng chọn lại ngày.</p>{onClearDateRange && <button type="button" className="min-h-11 rounded-lg border px-3" onClick={returnToMonth}>Xem từ đầu tháng</button>}</div>
        : !clubId ? <p className="text-sm text-muted-foreground">Chọn CLB để xem báo cáo.</p> : <>
        {(isClubOwner || isAdmin || isAccountant) && <AccountantFinanceTab key={clubId} clubId={clubId} dateRange={dateRange} onClearDateRange={returnToMonth} />}
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span>{dateRange ? `Dòng tiền từ ${dateRange.from} đến ${dateRange.to}.` : "Dòng tiền tại quầy từ đầu tháng đến thời điểm cập nhật."}</span>
          <button type="button" className="min-h-11 rounded-lg border px-3" onClick={returnToMonth}>{dateRange ? "Xem từ đầu tháng" : "Cập nhật đến hiện tại"}</button>
        </div>
        <SupabaseClientProvider client={supabase}>
          <CashierCashflowPanel key={JSON.stringify([clubId, effectiveRange.from, effectiveRange.to])} clubId={clubId} range={effectiveRange} />
        </SupabaseClientProvider>
      </>}
    </section>
  );
}
