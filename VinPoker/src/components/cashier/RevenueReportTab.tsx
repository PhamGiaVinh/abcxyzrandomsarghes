import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { SupabaseClientProvider } from "@/integrations/supabase/SupabaseClientContext";
import { AccountantFinanceTab } from "@/components/accountant/AccountantFinanceTab";
import CashierCashflowPanel from "@/ops/finance/CashierCashflowPanel";
import { currentMonthFinanceRange } from "@/ops/finance/financeReadAdapter";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Props { clubIds: string[]; clubs: { id: string; name: string }[]; }

export default function RevenueReportTab({ clubIds, clubs }: Props) {
  const { isClubOwner, isAdmin, isAccountant } = useAuth();
  const [selected, setSelected] = useState("");
  const [range, setRange] = useState(currentMonthFinanceRange);
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
      {!clubId ? <p className="text-sm text-muted-foreground">Chọn CLB để xem báo cáo.</p> : <>
        {(isClubOwner || isAdmin || isAccountant) && <AccountantFinanceTab key={clubId} clubId={clubId} />}
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span>Dòng tiền tại quầy từ đầu tháng đến thời điểm cập nhật.</span>
          <button type="button" className="min-h-11 rounded-lg border px-3" onClick={() => setRange(currentMonthFinanceRange())}>Cập nhật đến hiện tại</button>
        </div>
        <SupabaseClientProvider client={supabase}>
          <CashierCashflowPanel key={clubId} clubId={clubId} range={range} />
        </SupabaseClientProvider>
      </>}
    </section>
  );
}
