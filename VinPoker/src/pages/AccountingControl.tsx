import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { FEATURES } from "@/lib/featureFlags";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MockNotice } from "@/components/accounting-control/shared/Notices";
import { MOCK_OVERVIEW } from "@/components/accounting-control/mock/mockData";
import { OverviewTab } from "@/components/accounting-control/tabs/OverviewTab";
import { LiveOverviewTab } from "@/components/accounting-control/live/LiveOverviewTab";
import { DailyCloseTab } from "@/components/accounting-control/tabs/DailyCloseTab";
import { EventPnlTab } from "@/components/accounting-control/tabs/EventPnlTab";
import { SeriesPnlTab } from "@/components/accounting-control/tabs/SeriesPnlTab";
import { CashBankTab } from "@/components/accounting-control/tabs/CashBankTab";
import { PayoutLiabilityTab } from "@/components/accounting-control/tabs/PayoutLiabilityTab";
import { FnbFinanceTab } from "@/components/accounting-control/tabs/FnbFinanceTab";
import { PayrollCostTab } from "@/components/accounting-control/tabs/PayrollCostTab";
import { LivePayrollTab } from "@/components/accounting-control/live/LivePayrollTab";
import { LivePayoutTab } from "@/components/accounting-control/live/LivePayoutTab";
import { StakingEscrowTab } from "@/components/accounting-control/tabs/StakingEscrowTab";
import { VarianceAlertsTab } from "@/components/accounting-control/tabs/VarianceAlertsTab";
import { MonthlyReportTab } from "@/components/accounting-control/tabs/MonthlyReportTab";

export type AccountingTabId =
  | "overview"
  | "close"
  | "event-pnl"
  | "series-pnl"
  | "cash"
  | "payout"
  | "fnb"
  | "payroll"
  | "staking"
  | "alerts"
  | "monthly";

const TAB_DEFS: { id: AccountingTabId; label: string }[] = [
  { id: "overview", label: "Tổng quan" },
  { id: "close", label: "Chốt sổ" },
  { id: "event-pnl", label: "Event P&L" },
  { id: "series-pnl", label: "Series P&L" },
  { id: "cash", label: "Tiền & Bank" },
  { id: "payout", label: "Phải trả giải" },
  { id: "fnb", label: "F&B" },
  { id: "payroll", label: "Lương & chi phí" },
  { id: "staking", label: "Ký quỹ staking" },
  { id: "alerts", label: `Cảnh báo (${MOCK_OVERVIEW.openAlerts})` },
  { id: "monthly", label: "Báo cáo tháng" },
];

/**
 * "Tài chính & Đối soát" (Accounting Control) — buồng lái tài chính cho chủ CLB.
 * KẾ TOÁN QUẢN TRỊ (quyết định cho chủ CLB), không phải kế toán thuế/pháp lý.
 * Các tab đọc số thật theo cờ riêng; các tab thiết kế dùng dữ liệu mẫu.
 */
const AccountingControl = () => {
  const { isAdmin, isClubAdmin, isClubOwner } = useAuth();
  const [tab, setTab] = useState<AccountingTabId>("overview");

  // Sau tất cả hooks (rules-of-hooks). Gate trong render — không gate module-scope.
  if (!(isClubAdmin || isClubOwner)) return <Navigate to="/" replace />;
  // Flag OFF: ẩn với chủ CLB/admin CLB; chỉ super_admin còn thấy (đường UAT nội bộ —
  // cùng tiền lệ clubFinanceDashboard).
  if (!FEATURES.accountingControl && !isAdmin) return <Navigate to="/club/admin" replace />;

  const goTo = (id: string) => setTab(id as AccountingTabId);
  const liveTab = (tab === "overview" && FEATURES.accountingControlLiveOverview)
    || (tab === "payroll" && FEATURES.accountingControlLivePayroll)
    || (tab === "payout" && FEATURES.accountingControlLivePayout);

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-display text-2xl text-primary">Tài chính &amp; Đối soát</h1>
          <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-400">
            {liveTab ? "ĐỌC SỐ LIỆU CLB" : "DỮ LIỆU MẪU"}
          </Badge>
        </div>
        <p className="text-[12px] text-muted-foreground">
          Kế toán quản trị cho chủ CLB — không phải kế toán thuế/pháp lý. Module vận hành giữ
          nghiệp vụ; trang này chỉ tổng hợp tiền, đối soát và cảnh báo.
        </p>
      </header>

      <MockNotice partialLive={liveTab} />
      <Link to="/club/admin/finance" className="inline-block text-sm text-primary underline underline-offset-2">
        Mở tổng hợp tài chính CLB
      </Link>

      <Tabs value={tab} onValueChange={goTo} className="w-full">
        <div className="overflow-x-auto -mx-3 px-3 md:mx-0 md:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <TabsList className="inline-flex w-max justify-start h-auto flex-nowrap gap-1 p-1">
            {TAB_DEFS.map((t) => (
              <TabsTrigger key={t.id} value={t.id} className="whitespace-nowrap text-xs px-3 py-1.5">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="overview" className="mt-4">
          {FEATURES.accountingControlLiveOverview ? (
            <LiveOverviewTab onNavigate={goTo} />
          ) : (
            <OverviewTab onNavigate={goTo} />
          )}
        </TabsContent>
        <TabsContent value="close" className="mt-4">
          <DailyCloseTab />
        </TabsContent>
        <TabsContent value="event-pnl" className="mt-4">
          <EventPnlTab />
        </TabsContent>
        <TabsContent value="series-pnl" className="mt-4">
          <SeriesPnlTab />
        </TabsContent>
        <TabsContent value="cash" className="mt-4">
          <CashBankTab />
        </TabsContent>
        <TabsContent value="payout" className="mt-4">
          {FEATURES.accountingControlLivePayout ? <LivePayoutTab /> : <PayoutLiabilityTab />}
        </TabsContent>
        <TabsContent value="fnb" className="mt-4">
          <FnbFinanceTab />
        </TabsContent>
        <TabsContent value="payroll" className="mt-4">
          {FEATURES.accountingControlLivePayroll ? <LivePayrollTab /> : <PayrollCostTab />}
        </TabsContent>
        <TabsContent value="staking" className="mt-4">
          <StakingEscrowTab />
        </TabsContent>
        <TabsContent value="alerts" className="mt-4">
          <VarianceAlertsTab onNavigate={goTo} />
        </TabsContent>
        <TabsContent value="monthly" className="mt-4">
          <MonthlyReportTab />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AccountingControl;
