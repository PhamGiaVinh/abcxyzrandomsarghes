import { Navigate, useNavigate } from "react-router-dom";
import { ArrowLeft, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { FEATURES } from "@/lib/featureFlags";
import { SeriesCaptureConsole } from "@/components/series-intelligence/SeriesCaptureConsole";
import { DecisionRoomV1 } from "@/components/series-intelligence/DecisionRoomV1";

/**
 * Series Intelligence — CAPTURE console (standalone route /club/admin/series-decision-log). Flag- + role-gated
 * (redirects home when off / unauthorized). The full event-centric console lives in <SeriesCaptureConsole>,
 * reused as step ⑥ of the Series Intelligence page. DATA CAPTURE ONLY — no model, no prediction.
 */
export default function SeriesDecisionLogAdmin() {
  const nav = useNavigate();
  const { isAdmin, isClubAdmin, isClubOwner, loading, rolesLoading } = useAuth();

  if (loading || rolesLoading) return null;
  if (!FEATURES.seriesDecisionLog) return <Navigate to="/" replace />;
  if (!(isClubAdmin || isClubOwner || isAdmin)) return <Navigate to="/" replace />;

  return (
    <div className="container mx-auto max-w-4xl space-y-4 p-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => nav(-1)} aria-label="Quay lại">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl text-primary">
            <ClipboardList className="h-5 w-5" /> Nhật ký & Kết quả Series
          </h1>
          <p className="text-xs text-muted-foreground">
            Ghi quyết định vận hành + kết quả sau giải theo từng giải. Tầng GHI DỮ LIỆU — không model, không dự đoán.
          </p>
        </div>
      </div>

      {FEATURES.seriesDecisionPacketV1 ? <DecisionRoomV1 /> : <SeriesCaptureConsole />}
    </div>
  );
}
