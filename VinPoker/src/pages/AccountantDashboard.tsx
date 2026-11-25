import { useOperationalCapabilities } from "@/hooks/useOperationalCapabilities";
import { useCallback, useEffect, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { BarChart3, Calculator, ReceiptText, Table2, Wallet } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { FEATURES } from "@/lib/featureFlags";
import { RouteLoader } from "@/components/RouteLoader";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { staffSalarySource } from "@/lib/staffSalary/dataSource";
import { useSalaryClubs } from "@/hooks/staffSalary/useStaffSalary";
import { useAccountantCapabilities } from "@/hooks/accountant/useAccountantCapabilities";
import { PendingDbNotice } from "@/components/accountant/PendingDbNotice";
import DealerPayrollTab from "@/components/cashier/DealerPayrollTab";
import { StaffDirectoryManager } from "@/components/accountant/StaffDirectoryManager";
import { AccountantFnbTab } from "@/components/accountant/AccountantFnbTab";
import { AccountantFinanceTab } from "@/components/accountant/AccountantFinanceTab";
import ClubExpenses from "./ClubExpenses";
import StaffSalaryChot from "./StaffSalaryChot";

/**
 * Accountant workspace (/accountant) — the dedicated, role-gated "Kế toán" area, parallel
 * to the cashier / tracker / floor dashboards. Only accountants (club_accountants), club
 * owners, and admins reach it; everyone else is redirected.
 *
 * With FEATURES.accountantWorkspace OFF this renders exactly the pre-workspace page
 * (StaffSalaryChot) — a clean kill-switch. With it ON, a tabbed shell: tab availability is
 * decided by get_accountant_capabilities (per-domain server authz probe), NEVER inferred
 * from empty data. Every write keeps its server-side gate; the UI is presentation only.
 */
export default function AccountantDashboard() {
  const { loading, authError, user, isAdmin } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const reportDateRange = searchParams.has("from") || searchParams.has("to")
    ? {from: searchParams.get("from") ?? "", to: searchParams.get("to") ?? ""}
    : undefined;
  const clearReportDateRange = () => setSearchParams(previous => {
    const next = new URLSearchParams(previous);
    next.delete("from");
    next.delete("to");
    return next;
  });
  const requestedTab = searchParams.get("tab");
  const activeTab = requestedTab === "expenses" || requestedTab === "report" ? requestedTab : "salary";
  const source = staffSalarySource();
  const access = useOperationalCapabilities();
  const gateOk = !loading && !access.loading && !access.error && !!user && access.allows("accountant");

  const clubsQuery = useSalaryClubs(source, gateOk && FEATURES.accountantWorkspace);
  const clubs = clubsQuery.isError ? [] : clubsQuery.data ?? [];
  const clubId = searchParams.get("club");
  const setClubId = useCallback((value: string) => setSearchParams(previous => {
    const next = new URLSearchParams(previous);
    next.set("club", value);
    return next;
  }), [setSearchParams]);
  const [showStaffSettings, setShowStaffSettings] = useState(false);
  const [showFnbDetails, setShowFnbDetails] = useState(false);
  const [salaryView, setSalaryView] = useState<"staff" | "dealer">("staff");
  const activeClub = clubId !== null ? clubs.find((club) => club.id === clubId) : clubs[0];
  const activeClubId = activeClub?.id ?? null;
  const { caps } = useAccountantCapabilities(FEATURES.accountantWorkspace ? activeClubId : null);

  useEffect(() => {
    if (clubId === null && activeClubId) setClubId(activeClubId);
  }, [clubId, activeClubId, setClubId]);

  if (loading || access.loading) return <RouteLoader />;
  if (authError || access.error) return <p role="alert" className="p-6">Chưa xác minh được quyền nhân sự. Vui lòng tải lại trang.</p>;
  if (!user) return <Navigate to="/auth" replace />;
  if (!access.allows("accountant")) return <Navigate to="/" replace />;

  // Kill-switch: exact pre-workspace behavior.
  if (!FEATURES.accountantWorkspace) return <StaffSalaryChot />;

  // Owner/admin already pass the pre-migration authz for dealer payroll; accountant-only
  // users need migration 20261236000000 (probe says so). Approve/lock stays owner/admin.
  const hasOwnerAdmin = !!activeClub && (isAdmin || activeClub.role === "owner" || activeClub.role === "admin");
  const dealerAvailable = hasOwnerAdmin || (caps.state === "ok" && caps.payroll);
  const staffAvailable = hasOwnerAdmin || (caps.state === "ok" && caps.staff);
  const expensesAvailable = hasOwnerAdmin || (caps.state === "ok" && caps.expenses);
  const fnbAvailable = hasOwnerAdmin || (caps.state === "ok" && caps.fnbReport);
  const financeAvailable = hasOwnerAdmin || (caps.state === "ok" && caps.financeSummary);
  const hideApprovalActions = !hasOwnerAdmin;

  return (
    <div className="container mx-auto max-w-6xl px-4 py-6 space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-2xl text-primary inline-flex items-center gap-2">
              <Calculator className="w-6 h-6" />
              {activeTab === "salary" ? "Lương" : activeTab === "expenses" ? "Sổ chi phí" : "Đối soát"}
            </h1>
            <Badge variant="outline" className="text-[10px]">
              {activeClub?.role === "accountant" ? "KẾ TOÁN CLB" : activeClub?.role === "owner" ? "CHỦ CLB" : "ADMIN"}
            </Badge>
          </div>
          <p className="text-[12px] text-muted-foreground max-w-2xl">
            Chọn CLB, đối chiếu lương và chi phí, rồi gửi chủ CLB duyệt.
          </p>
        </div>
        {(clubs.length > 1 || (clubs.length === 1 && !activeClub)) && (
          <div className="w-full sm:w-64">
            <Select value={activeClubId ?? ""} onValueChange={setClubId}>
              <SelectTrigger className="bg-background border-border">
                <SelectValue placeholder="Chọn CLB" />
              </SelectTrigger>
              <SelectContent>
                {clubs.map((club) => (
                  <SelectItem key={club.id} value={club.id}>
                    {club.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </header>

      {clubsQuery.isError && <PendingDbNotice state="network_error" />}
      <Tabs key={JSON.stringify([user.id, activeClubId, activeClub?.role])} value={activeTab} onValueChange={tab => setSearchParams(previous => { const next = new URLSearchParams(previous); next.set("tab", tab); return next; })} className="space-y-4">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="salary" className="gap-1.5">
            <Wallet className="w-4 h-4" />
            Bảng lương
          </TabsTrigger>
          <TabsTrigger value="expenses" className="gap-1.5">
            <ReceiptText className="w-4 h-4" />
            Sổ chi phí
          </TabsTrigger>
          <TabsTrigger value="report" className="gap-1.5">
            <BarChart3 className="w-4 h-4" />
            Báo cáo
          </TabsTrigger>
        </TabsList>

        <TabsContent value="salary" className="space-y-3">
          <details onToggle={event => setShowStaffSettings(event.currentTarget.open)} className="rounded-lg border border-border p-3">
            <summary className="cursor-pointer text-sm font-medium">Danh sách nhân viên và mức lương</summary>
            {showStaffSettings && (activeClub && staffAvailable
              ? <StaffDirectoryManager key={activeClub.id} clubId={activeClub.id} />
              : <PendingDbNotice state={caps.state === "ok" ? "forbidden" : caps.state} />)}
          </details>
          <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
            {(["staff", "dealer"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setSalaryView(v)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors",
                  salaryView === v ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {v === "staff" ? <Wallet className="w-3.5 h-3.5" /> : <Table2 className="w-3.5 h-3.5" />}
                {v === "staff" ? "Nhân viên" : "Dealer"}
              </button>
            ))}
          </div>

          {salaryView === "staff" ? (
            activeClub && staffAvailable ? (
              <StaffSalaryChot embedded scopedClubId={activeClub.id} />
            ) : (
              <PendingDbNotice state={caps.state === "ok" ? "forbidden" : caps.state} />
            )
          ) : activeClub && dealerAvailable ? (
            <DealerPayrollTab
              clubIds={[activeClub.id]}
              clubs={[{ id: activeClub.id, name: activeClub.name }]}
              showShiftReviews
              hideApprovalActions={hideApprovalActions}
            />
          ) : (
            <PendingDbNotice state={caps.state === "ok" ? "forbidden" : caps.state} />
          )}
        </TabsContent>

        <TabsContent value="expenses">
          {activeClub && expensesAvailable ? (
            <ClubExpenses embedded scopedClubId={activeClub.id}
              dateRange={reportDateRange}
              onClearDateRange={clearReportDateRange}
            />
          ) : (
            <PendingDbNotice state={caps.state === "ok" ? "forbidden" : caps.state} />
          )}
        </TabsContent>

        <TabsContent value="report" className="space-y-3">
          {activeClub && financeAvailable ? (
            <AccountantFinanceTab clubId={activeClubId}
              dateRange={reportDateRange}
              onClearDateRange={clearReportDateRange}
            />
          ) : (
            <PendingDbNotice state={caps.state === "ok" ? "forbidden" : caps.state} />
          )}
      {activeClub && fnbAvailable && (
        <details key={activeClub.id} onToggle={event => setShowFnbDetails(event.currentTarget.open)} className="rounded-lg border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">Chi tiết bán hàng F&amp;B</summary>
          {showFnbDetails && <AccountantFnbTab clubId={activeClub.id} />}
        </details>
      )}
        </TabsContent>
      </Tabs>

    </div>
  );
}
