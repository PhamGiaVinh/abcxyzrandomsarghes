import { useOperationalCapabilities } from "@/hooks/useOperationalCapabilities";
import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { BarChart3, Calculator, ReceiptText, Table2, Users, UtensilsCrossed, Wallet } from "lucide-react";
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
  const source = staffSalarySource();
  const access = useOperationalCapabilities();
  const gateOk = !loading && !access.loading && !access.error && !!user && access.allows("accountant");

  const clubsQuery = useSalaryClubs(source, gateOk && FEATURES.accountantWorkspace);
  const clubs = clubsQuery.isError ? [] : clubsQuery.data ?? [];
  const [clubId, setClubId] = useState("");
  const [salaryView, setSalaryView] = useState<"staff" | "dealer">("staff");
  const activeClub = clubId ? clubs.find((club) => club.id === clubId) : clubs[0];
  const activeClubId = activeClub?.id ?? null;
  const { caps } = useAccountantCapabilities(FEATURES.accountantWorkspace ? activeClubId : null);

  useEffect(() => {
    if (!clubId && activeClubId) setClubId(activeClubId);
  }, [clubId, activeClubId]);

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
              Tài chính &amp; Đối soát · nhân sự
            </h1>
            <Badge variant="outline" className="text-[10px]">
              {activeClub?.role === "accountant" ? "KẾ TOÁN CLB" : activeClub?.role === "owner" ? "CHỦ CLB" : "ADMIN"}
            </Badge>
          </div>
          <p className="text-[12px] text-muted-foreground max-w-2xl">
            Bàn làm việc kế toán: bảng lương, nhân viên, chi phí và báo cáo. Kế toán chốt + gửi — chủ CLB duyệt.
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
      <Tabs key={JSON.stringify([user.id, activeClubId, activeClub?.role])} defaultValue="salary" className="space-y-4">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="salary" className="gap-1.5">
            <Wallet className="w-4 h-4" />
            Bảng lương
          </TabsTrigger>
          <TabsTrigger value="staff" className="gap-1.5">
            <Users className="w-4 h-4" />
            Nhân viên &amp; lương
          </TabsTrigger>
          <TabsTrigger value="expenses" className="gap-1.5">
            <ReceiptText className="w-4 h-4" />
            Sổ chi phí
          </TabsTrigger>
          <TabsTrigger value="fnb" className="gap-1.5">
            <UtensilsCrossed className="w-4 h-4" />
            F&amp;B thu chi
          </TabsTrigger>
          <TabsTrigger value="report" className="gap-1.5">
            <BarChart3 className="w-4 h-4" />
            Báo cáo
          </TabsTrigger>
        </TabsList>

        <TabsContent value="salary" className="space-y-3">
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
              hideApprovalActions={hideApprovalActions}
            />
          ) : (
            <PendingDbNotice state={caps.state === "ok" ? "forbidden" : caps.state} />
          )}
        </TabsContent>

        <TabsContent value="staff">
          {activeClub && staffAvailable ? (
            <StaffDirectoryManager clubId={activeClubId} />
          ) : (
            <PendingDbNotice state={caps.state === "ok" ? "forbidden" : caps.state} />
          )}
        </TabsContent>

        <TabsContent value="expenses">
          {activeClub && expensesAvailable ? (
            <ClubExpenses embedded scopedClubId={activeClub.id} />
          ) : (
            <PendingDbNotice state={caps.state === "ok" ? "forbidden" : caps.state} />
          )}
        </TabsContent>

        <TabsContent value="fnb">
          {activeClub && fnbAvailable ? (
            <AccountantFnbTab clubId={activeClubId} />
          ) : (
            <PendingDbNotice state={caps.state === "ok" ? "forbidden" : caps.state} />
          )}
        </TabsContent>

        <TabsContent value="report">
          {activeClub && financeAvailable ? (
            <AccountantFinanceTab clubId={activeClubId} />
          ) : (
            <PendingDbNotice state={caps.state === "ok" ? "forbidden" : caps.state} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
