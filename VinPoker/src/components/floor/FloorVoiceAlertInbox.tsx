import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AlertTriangle } from "lucide-react";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { useTrackerFloorAlertLocations } from "@/lib/tracker-floor-alerts/useTrackerFloorAlertLocations";

type TournamentRef = { id: string; name: string };
type AlertRow = {
  id: string;
  tournament_id: string;
  physical_table_id: string;
  hand_id: string | null;
  title: string;
  priority: string;
  status: string;
};

type InboxProps = {
  tournaments: readonly TournamentRef[];
  readScope: string | null;
  onSelect: (tournamentId: string, alertId: string) => void;
};

export function FloorVoiceAlertInbox(props: InboxProps) {
  if (!props.readScope) return null;
  const tournamentIds = props.tournaments.map((tournament) => tournament.id).sort().join(",");
  return <ScopedVoiceAlertInbox key={JSON.stringify([props.readScope, tournamentIds])} {...props} tournamentIds={tournamentIds} />;
}

function ScopedVoiceAlertInbox({ tournaments, onSelect, tournamentIds }: InboxProps & { tournamentIds: string }) {
  const client = useSupabaseClient() as SupabaseClient;
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let readGeneration = 0;
    const load = async () => {
      if (!tournamentIds) {
        setAlerts([]);
        setError(null);
        return;
      }
      const generation = ++readGeneration;
      try {
        const { data, error: readError } = await client
          .from("tracker_floor_alerts")
          .select("id,tournament_id,physical_table_id,hand_id,title,priority,status")
          .in("tournament_id", tournamentIds.split(","))
          .in("status", ["open", "acknowledged", "in_progress"])
          .order("created_at", { ascending: true });
        if (!active || generation !== readGeneration) return;
        if (readError) {
          setAlerts([]);
          setError(readError.message);
          return;
        }
        setError(null);
        setAlerts((data ?? []) as AlertRow[]);
      } catch {
        if (!active || generation !== readGeneration) return;
        setAlerts([]);
        setError("Mất kết nối. Cảnh báo sẽ được tải lại khi kết nối trở lại.");
      }
    };
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 10_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [client, tournamentIds]);

  const locationFor = useTrackerFloorAlertLocations(client, alerts);

  if (!alerts.length && !error) return null;
  const names = new Map(tournaments.map((tournament) => [tournament.id, tournament.name]));

  return (
    <section className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4" aria-label="Cảnh báo Voice Tracker">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-amber-300">
        <AlertTriangle className="h-4 w-4" /> Cảnh báo Voice Tracker {alerts.length > 0 && `(${alerts.length})`}
      </h2>
      {error && <p className="text-xs text-rose-300">Không tải được cảnh báo: {error}</p>}
      <div className="space-y-2">
        {alerts.map((alert) => {
          const location = locationFor(alert);
          return <div
            key={alert.id}
            className="rounded-xl border border-amber-300/20 bg-black/20 px-3 py-2 text-sm text-foreground"
          >
            <button className="block w-full rounded-lg p-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300" type="button" onClick={() => onSelect(alert.tournament_id, alert.id)}>
              <span className="block font-semibold">{alert.title}</span>
              <span className="block text-xs text-muted-foreground">
                {names.get(alert.tournament_id) ?? "Giải đấu"} · {location?.tableNumber != null ? `Bàn ${location.tableNumber}` : "Bàn đang tải"}
                {location?.handNumber != null ? ` · Hand #${location.handNumber}` : ""}
              </span>
              <span className="mt-1 block text-xs text-amber-100">{location?.handVoided ? "Hand đã void; Floor cần đóng cảnh báo." : "Action sai chưa được chỉ rõ; xem toàn bộ action để tìm chỗ cần sửa."}</span>
              <span className="mt-1 block text-xs font-semibold text-amber-300">{location?.handStatus === "completed" && !location?.handVoided ? "Xem toàn bộ ván và sửa hand →" : "Xem toàn bộ ván →"}</span>
            </button>
          </div>;
        })}
      </div>
    </section>
  );
}
