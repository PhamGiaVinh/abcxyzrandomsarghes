import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useOperatorClubs } from "@/hooks/useOperatorClubs";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle, Table2, Calculator, CalendarRange } from "lucide-react";
import SwingPanel from "@/components/cashier/DealerSwingTab";
import DealerPayrollTab from "@/components/cashier/DealerPayrollTab";
import DealerPayrollTabV2 from "@/components/cashier/DealerPayrollTabV2";
import ShiftPlannerTab from "@/components/cashier/ShiftPlannerTab";
import ShiftPlannerV2Tab from "@/components/cashier/shift-planner-v2/ShiftPlannerV2Tab";
import { FEATURES } from "@/lib/featureFlags";
import { useTranslation } from "react-i18next";

// The planner owns a draft and writes to one club. Never combine multiple
// authorized clubs into the first club's schedule or retain a draft across scopes.
function DealerPlannerScope({ clubs, v2, autofillEnabled }: {
  clubs: { id: string; name: string }[];
  v2: boolean;
  autofillEnabled: boolean;
}) {
  const { t } = useTranslation();
  const [selection, setSelection] = useState("");
  const club = clubs.find(c => c.id === selection) ?? (clubs.length === 1 ? clubs[0] : null);
  return <div className="space-y-4">
    <div className="space-y-2">
      <label htmlFor="dealer-planner-club" className="text-sm font-medium">{t("dealerPlannerScope.club")}</label>
      <select id="dealer-planner-club" value={club?.id ?? ""} onChange={e => setSelection(e.target.value)}
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <option value="" disabled>{t("dealerPlannerScope.choose")}</option>
        {clubs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <p className="text-sm text-muted-foreground">{t("dealerPlannerScope.hint")}</p>
    </div>
    {club ? (v2
      ? <ShiftPlannerV2Tab key={club.id} clubIds={[club.id]} clubs={[club]} mode="live" autofillEnabled={autofillEnabled} />
      : <ShiftPlannerTab key={club.id} clubIds={[club.id]} clubs={[club]} mode="live" />)
      : <p role="status" className="text-sm text-muted-foreground">{t("dealerPlannerScope.choose")}</p>}
  </div>;
}

/**
 * Dealer Swing — Dealer Swing + Bảng lương (payroll) grouped in one destination.
 * Reuses DealerSwingTab and DealerPayrollTab as-is; club scope + guard mirror the
 * former swing/payroll sections in CashierDashboard so behaviour is unchanged.
 */
export default function DealerSwingDashboard() {
  const { user, loading, isAdmin, isClubAdmin, isClubOwner } = useAuth();
  const nav = useNavigate();
  const { clubs, clubIds, dealerClubIds } = useOperatorClubs();
  const [tab, setTab] = useState("swing");  // controlled so SwingPanel can deep-link to "payroll" (D1)

  useEffect(() => {
    if (loading) return;
    if (!user) { nav("/auth"); return; }
  }, [loading, user, nav]);

  if (loading || !user) {
    return <div className="container mx-auto p-6"><Skeleton className="h-96 rounded-xl" /></div>;
  }
  if (clubs === null) {
    return <div className="container mx-auto p-6"><Skeleton className="h-96 rounded-xl" /></div>;
  }
  if (dealerClubIds.length === 0 && !isAdmin) {
    return (
      <div className="container mx-auto p-6">
        <Card className="p-8 text-center space-y-3">
          <AlertTriangle className="w-10 h-10 mx-auto text-warning" />
          <div className="text-lg font-bold">Bạn chưa được phân công CLB nào</div>
          <p className="text-sm text-muted-foreground">
            Liên hệ Super Admin để được gán quyền điều hành dealer (Dealer Swing) cho câu lạc bộ.
          </p>
        </Card>
      </div>
    );
  }

  const scopedIds = dealerClubIds.length > 0 ? dealerClubIds : clubIds;
  const plannerClubs = clubs.filter(club => scopedIds.includes(club.id));

  // Phase 2B preview gate: while the global flag is OFF, owner / club-admin /
  // super-admin still see the planner tab on this (already control-staff-only) page
  // for live UAT. Flip FEATURES.dealerShiftPlanner ON after UAT to expose it to all
  // dealer-control staff. Live mode reads the dealer_shift_* tables (Phase 2A applied).
  const showShiftPlanner = FEATURES.dealerShiftPlanner || isAdmin || isClubAdmin || isClubOwner;
  // V2 preview gate (same pattern as Phase 2B above): while FEATURES.shiftPlannerV2
  // is OFF, owner / club-admin / super-admin see the V2 planner for live UAT;
  // everyone else keeps V1 unchanged. Flip the flag ON after UAT for all staff.
  const showPlannerV2 = FEATURES.shiftPlannerV2 || isAdmin || isClubAdmin || isClubOwner;
  // Auto-fill ("⚡ Tự động xếp") preview gate — same pattern: owner/admin UAT it
  // while FEATURES.shiftPlannerAutofill is OFF; flip ON for all staff after UAT.
  const showAutofill = FEATURES.shiftPlannerAutofill || isAdmin || isClubAdmin || isClubOwner;
  // The PT policy mutation is server-authorized and audit logged. Keep the V2
  // tab dark for routine operators while owner/admin users can UAT it first.
  const showSalaryV2 = FEATURES.salaryTabV2 || isAdmin || isClubAdmin || isClubOwner;

  return (
    <div className="operations-typography container mx-auto min-w-0 p-3 md:p-6">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/15 text-primary rounded-md text-xs font-bold border border-primary/30">
          <Table2 className="w-3.5 h-3.5" /> DEALER SWING
        </div>
        <div className="text-sm text-muted-foreground">
          {clubs.length === 0 ? "Toàn quyền (Admin)" : clubs.length === 1 ? clubs[0].name : `${clubs.length} CLB`}
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className={`grid w-full ${showShiftPlanner ? "grid-cols-3" : "grid-cols-2"} h-auto [&>button]:min-h-11 [&>button]:min-w-0 [&>button]:whitespace-normal [&>button]:px-2 [&>button]:text-xs sm:[&>button]:text-sm [&>button>svg]:shrink-0`}>
          <TabsTrigger value="swing"><Table2 className="w-4 h-4 mr-1" /> Dealer Swing</TabsTrigger>
          <TabsTrigger value="payroll"><Calculator className="w-4 h-4 mr-1" /> Bảng lương</TabsTrigger>
          {showShiftPlanner && (
            <TabsTrigger value="shift_planner"><CalendarRange className="w-4 h-4 mr-1" /> Xếp lịch dealer</TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="swing" className="mt-4">
          {/* D1 — the retired inline payroll quick-view now deep-links to the canonical Bảng lương tab. */}
          <SwingPanel clubIds={scopedIds} clubs={clubs} onOpenPayroll={() => setTab("payroll")} />
        </TabsContent>
        <TabsContent value="payroll" className="mt-4">
          {showSalaryV2
            ? <DealerPayrollTabV2 clubIds={scopedIds} clubs={clubs} />
            : <DealerPayrollTab clubIds={scopedIds} clubs={clubs} />}
        </TabsContent>
        {showShiftPlanner && (
          <TabsContent value="shift_planner" className="mt-4">
            {/* V2 = guided 4-step flow (owner-approved redesign); non-preview roles keep V1. */}
            <DealerPlannerScope key={`${user.id}:${[...scopedIds].sort().join(",")}`}
              clubs={plannerClubs} v2={showPlannerV2} autofillEnabled={showAutofill} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
