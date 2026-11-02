import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { useOperatorClubs } from "@/hooks/useOperatorClubs";
import { useStableFloorClubIds } from "@/hooks/useStableFloorClubIds";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, LayoutGrid } from "lucide-react";
import { BackButton } from "@/components/BackButton";
import TournamentLivePanel from "@/components/cashier/TournamentLivePanel";
import {Button} from '@/components/ui/button';

/**
 * Floor — room management (table draw, prize structure, seating).
 * Reuses TournamentLivePanel in "floor" mode. Club scope + guard mirror the
 * former tournament_live section in CashierDashboard so data parity is preserved.
 */
export default function FloorDashboard() {
  const { t } = useTranslation();
  const { user, loading, isAdmin } = useAuth();
  const nav = useNavigate();
  const { clubs, operatorClubIds, dealerClubIds,error,scopeVerified,refresh } = useOperatorClubs();
  // Capability IDs come from the caller-bound scope RPC. `clubs` is display
  // metadata and can be RLS-filtered, so it must never decide Floor access.
  const scopedIds = useStableFloorClubIds(operatorClubIds, dealerClubIds);

  useEffect(() => {
    if (loading) return;
    if (!user) { nav("/auth"); return; }
  }, [loading, user, nav]);

  if (loading || !user) {
    return <div className="container mx-auto p-6"><Skeleton className="h-96 rounded-xl" /></div>;
  }
  if(error&&!scopeVerified)return <div className="container mx-auto p-6"><Card className="space-y-3 p-8 text-center">
    <p role="alert">{error}</p><Button onClick={refresh}>Thử lại</Button></Card></div>;
  if (clubs === null) {
    return <div className="container mx-auto p-6"><Skeleton className="h-96 rounded-xl" /></div>;
  }
  // Floor access = caller-bound owner/cashier/floor scope plus dealer assignments.
  // Do not gate this on the optional club-name lookup above.
  if (scopedIds.length === 0 && !isAdmin) {
    return (
      <div className="container mx-auto p-6">
        <Card className="p-8 text-center space-y-3">
          <AlertTriangle className="w-10 h-10 mx-auto text-warning" />
          <div className="text-lg font-bold">Bạn chưa được phân công CLB nào</div>
          <p className="text-sm text-muted-foreground">
            Liên hệ Super Admin để được gán quyền điều hành sàn (Floor) cho câu lạc bộ.
          </p>
        </Card>
      </div>
    );
  }

  const scopedClubLabel = clubs.length === scopedIds.length
    ? (clubs.length === 1 ? clubs[0].name : `${clubs.length} CLB`)
    : scopedIds.length > 0 ? `${scopedIds.length} CLB được phân quyền` : "Toàn quyền (Admin)";

  return (
    <div className="operations-typography container mx-auto min-w-0 p-3 md:p-6">
      {error&&<div role="status" className="mb-3 flex flex-wrap items-center gap-3 text-sm text-muted-foreground"><span>{error}</span><Button variant="outline" onClick={refresh}>Thử lại</Button></div>}
      <BackButton to="/" label={t("nav.schedule")} className="mb-2" />
      <div className="mb-4 flex items-center gap-3">
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/15 text-primary rounded-md text-xs font-bold border border-primary/30">
          <LayoutGrid className="w-3.5 h-3.5" /> FLOOR
        </div>
        <div className="text-sm text-muted-foreground">
          {scopedClubLabel}
        </div>
      </div>
      <TournamentLivePanel mode="floor" clubIds={scopedIds} clubs={clubs} />
    </div>
  );
}
