import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AlertTriangle } from "lucide-react";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { useTrackerFloorAlertLocations } from "@/lib/tracker-floor-alerts/useTrackerFloorAlertLocations";
import { formatDateTime } from "@/lib/format";
import { startLiveReportRefresh } from "@/lib/liveReportRefresh";
import { observeTrackerContextRead } from "@/lib/tournament/observeTrackerContextRead";

type TournamentRef = { id: string; name: string };
type AlertRow = {
  id: string;
  tournament_id: string;
  physical_table_id: string;
  hand_id: string | null;
  alert_kind: string;
  source_action_id: string | null;
  title: string;
  priority: string;
  status: string;
  updated_at: string;
};
const noAlerts: AlertRow[] = [];

export function FloorVoiceAlertInbox({ tournaments, onSelect }: {
  tournaments: readonly TournamentRef[];
  onSelect: (tournamentId: string, alertId: string) => void;
}) {
  const client = useSupabaseClient() as SupabaseClient;
  const [result, setResult] = useState<{ scope: string; alerts: AlertRow[]; error: boolean }>();
  const tournamentIds = tournaments.map((tournament) => tournament.id).sort().join(",");
  const alerts = result?.scope === tournamentIds ? result.alerts : noAlerts;
  const error = result?.scope === tournamentIds && result.error;

  useEffect(() => {
    if (!tournamentIds) return;
    let active = true;
    let controller: AbortController | undefined;
    const ids = tournamentIds.split(",");
    const load = async () => {
      if (document.visibilityState === "hidden") return;
      const request = new AbortController();
      controller = request;
      try {
        const { data, error: readError } = await observeTrackerContextRead(client
          .from("tracker_floor_alerts")
          .select("id,tournament_id,physical_table_id,hand_id,alert_kind,source_action_id,title,priority,status,updated_at")
          .in("tournament_id", ids)
          .in("status", ["open", "acknowledged", "in_progress"])
          .order("created_at", { ascending: true })
          .abortSignal(request.signal));
        if (readError) throw readError;
        const rows = (data ?? []) as AlertRow[];
        if (active) setResult({ scope: tournamentIds, alerts: rows.filter(row => ids.includes(row.tournament_id)), error: false });
      } catch {
        if (active) setResult({ scope: tournamentIds, alerts: noAlerts, error: true });
      } finally {
        request.abort();
        controller = undefined;
      }
    };
    const stop = startLiveReportRefresh(load, 10_000);
    return () => {
      active = false;
      stop();
      controller?.abort();
    };
  }, [client, tournamentIds]);

  const locationFor = useTrackerFloorAlertLocations(client, alerts);

  if (!alerts.length && !error) return null;
  const names = new Map(tournaments.map((tournament) => [tournament.id, tournament.name]));

  return (
    <section className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4" aria-label="Việc TD cần xử lý">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-amber-300">
        <AlertTriangle className="h-4 w-4" /> Việc TD cần xử lý {alerts.length > 0 && `(${alerts.length})`}
      </h2>
      {error && <p role="alert" className="text-xs text-rose-300">Chưa xác minh được cảnh báo Tracker.</p>}
      <div className="space-y-2">
        {alerts.map((alert) => {
          const location = locationFor(alert);
          const reviewHand = alert.hand_id && alert.alert_kind !== "display_issue" && !location?.handVoided && !location?.unavailable;
          const tableLabel = location?.unavailable ? "Chưa xác minh được bàn"
            : location?.tableNumber != null ? `Bàn ${location.tableNumber}` : "Bàn đang tải";
          return <div
            key={alert.id}
            className="rounded-xl border border-amber-300/20 bg-black/20 px-3 py-2 text-sm text-foreground"
          >
            <button className="block w-full rounded-lg p-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300" type="button" onClick={() => onSelect(alert.tournament_id, alert.id)}>
              <span className="block font-semibold">{alert.title}</span>
              <span className="block text-xs text-muted-foreground">
                {names.get(alert.tournament_id) ?? "Giải đấu"} · {tableLabel}
                {location?.handNumber != null ? ` · Hand #${location.handNumber}` : ""}
                {Number.isFinite(Date.parse(alert.updated_at)) && (
                  <> · Cập nhật <time dateTime={alert.updated_at}>{formatDateTime(alert.updated_at)}</time></>
                )}
              </span>
              {location?.handVoided && <span className="mt-1 block text-xs text-amber-100">Hand đã void; Floor cần đóng cảnh báo.</span>}
              {reviewHand && alert.alert_kind === "wrong_action" && !alert.source_action_id && (
                <span className="mt-1 block text-xs text-amber-100">Action sai chưa được chỉ rõ; xem nhật ký ván trước khi sửa.</span>
              )}
              <span className="mt-1 block text-xs font-semibold text-amber-300">
                {reviewHand ? location?.handStatus === "completed" ? "Xem toàn bộ ván và sửa hand →" : "Xem toàn bộ ván →" : "Mở cảnh báo →"}
              </span>
            </button>
          </div>;
        })}
      </div>
    </section>
  );
}
