import { useEffect, useState, type ReactNode } from "react";
import { LockKeyhole, Mic, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { FEATURES } from "@/lib/featureFlags";
import { createFloorTableControlV3Client, type FloorTableControlV3Rpc } from "@/lib/floorTableControlV3";
import type { StandaloneHandInput } from "@/components/cashier/tournament-live/handinput/useStandaloneHandInput";
import { MultiDayBaggingPanel } from "@/ops/chip-ops/MultiDayBaggingPanel";
import { DealerShotClock } from "./DealerShotClock";
import { DealerFloorAlertControls } from "./DealerFloorAlertControls";
import "./dealerTablet.css";

type CockpitProps = {
  hook: StandaloneHandInput; header: ReactNode; orphan: ReactNode; progress: ReactNode;
  felt: ReactNode; board: ReactNode; voice: ReactNode; guided: ReactNode; log: ReactNode;
};
export function DealerTabletCockpit(props: CockpitProps) {
  const { hook } = props;
  const [trackerAllowed, setTrackerAllowed] = useState(false);
  const [flight, setFlight] = useState(false);
  useEffect(() => {
    let active = true;
    setFlight(false);
    const check = async () => {
      try {
        const result = await supabase.from("tournaments").select("phase")
          .eq("id", hook.tournamentId).maybeSingle();
        if (active) setFlight(!result.error && result.data?.phase === "flight");
      } catch { if (active) setFlight(false); }
    };
    if (hook.tournamentId) void check();
    return () => { active = false; };
  }, [hook.tournamentId]);
  useEffect(() => {
    let alive = true;
    setTrackerAllowed(false);
    let requestVersion = 0;
    const rpc = supabase.rpc.bind(supabase) as unknown as FloorTableControlV3Rpc;
    const client = createFloorTableControlV3Client(rpc);
    const refresh = async () => {
      const version = ++requestVersion;
      const publish = (allowed: boolean) => { if (alive && version === requestVersion) setTrackerAllowed(allowed); };
      try {
        // Roster display metadata (names, seat locks, table numbers) is not writer authority.
        // The Floor roster is operator-only. This context also scopes assigned dealers.
        const result = await supabase.rpc("get_tracker_hand_input_tables_v4" as never, { p_tournament_id: hook.tournamentId } as never);
        const context = result.data as { ok?: boolean; tables?: Record<string, unknown>[] } | null;
        const matches = !result.error && context?.ok === true && Array.isArray(context.tables) ? context.tables.filter((row) =>
          row && typeof row === "object" && row.tournament_table_id === hook.tournamentTableId) : [];
        const table = matches.length === 1 ? matches[0] : null;
        if (!table || table.control_mode !== "tracker" || table.can_manual_cards !== true
          || typeof table.table_session_id !== "string" || !table.table_session_id
          || typeof table.control_epoch !== "number" || !Number.isSafeInteger(table.control_epoch) || table.control_epoch < 1) { publish(false); return; }
        const authority = await client.validateTrackerContext({ tournamentId: hook.tournamentId, tournamentTableId: hook.tournamentTableId!, tableSessionId: table.table_session_id, controlEpoch: table.control_epoch });
        publish(authority.ok && !!authority.data && typeof authority.data === "object" && "ok" in authority.data && authority.data.ok === true);
      } catch { publish(false); }
    };
    void refresh();
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    return () => { alive = false; window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [hook.tournamentId, hook.tournamentTableId]);
  return <>
    <DealerTabletLayout {...props} trackerAllowed={trackerAllowed} />
    {flight && <div className="mx-auto max-w-5xl px-4 pb-5">
      <MultiDayBaggingPanel tournamentId={hook.tournamentId} />
    </div>}
  </>;
}

/** Presentation shared with the offline tablet preview; production authority is loaded above. */
export function DealerTabletLayout({ hook, header, orphan, progress, felt, board, voice, guided, log, trackerAllowed, floorAlertsEnabled = FEATURES.trackerOperationalFloorAlerts }: CockpitProps & { trackerAllowed: boolean; floorAlertsEnabled?: boolean }) {
  const [normal, setNormal] = useState(false);
  const [input, setInput] = useState<"manual" | "voice">("manual");
  const tracker = trackerAllowed && !normal;
  const clockActive = tracker && hook.handStarted && hook.showActionStep && Boolean(hook.engineActor);
  const clockBlocked = hook.submitting || hook.actionSyncBlocked || hook.isReadOnly || hook.syncPhase === "sending" || hook.syncPhase === "error" || hook.syncPhase === "uncertain";
  const turnKey = `${hook.handId}:${hook.currentStreet}:${hook.engineActor?.player_id}:${hook.actions.length}`;
  return <div className="dealer-cockpit">
    <header className="dealer-cockpit-header">{header}</header>
    <nav className="dealer-modebar" aria-label="Chế độ bàn Dealer">
      <span className="text-xs text-zinc-400">Chế độ</span>
      <div className="dealer-segment"><button aria-pressed={!tracker} onClick={() => setNormal(true)}>Thường</button><button disabled={!trackerAllowed} aria-pressed={tracker} onClick={() => setNormal(false)}>Tracker</button></div>
      <span className="dealer-access">{trackerAllowed ? <ShieldCheck size={17} /> : <LockKeyhole size={17} />}{trackerAllowed ? "Floor đã cấp quyền Tracker" : "Tracker cần phiên bàn và quyền Floor hợp lệ"}</span>
      {tracker && <div className="dealer-segment ml-auto" aria-label="Cách nhập Tracker"><button aria-pressed={input === "manual"} onClick={() => setInput("manual")}>Thủ công</button><button aria-pressed={input === "voice"} onClick={() => setInput("voice")}><Mic size={15} />Voice Assist</button></div>}
    </nav>
    {tracker && orphan}
    {tracker && floorAlertsEnabled && hook.tournamentTableId && <DealerFloorAlertControls key={`${hook.tournamentId}:${hook.tournamentTableId}`} tournamentId={hook.tournamentId} tournamentTableId={hook.tournamentTableId} handId={hook.handId ?? null} enabled />}
    <div className="dealer-cockpit-grid">
      <div className="dealer-table-region"><div>{progress}</div><div {...(!tracker ? { inert: "" } : {})}>{felt}</div>{board}<details className="dealer-log"><summary>Nhật ký thao tác</summary>{log}</details></div>
      <aside className="dealer-control-region">
        <DealerShotClock key={`${hook.tournamentTableId}:${tracker}`} turnKey={turnKey} active={clockActive} blocked={tracker && clockBlocked} playerLabel={clockActive ? `Ghế ${hook.engineActor!.seat_number} · ${hook.playerName(hook.engineActor!.player_id)}` : "Dealer điều khiển đồng hồ"} />
        {tracker ? <>
          {input === "voice" && <div className="dealer-voice-region">{voice}</div>}
          {input === "manual" || !hook.showActionStep ? guided : <details className="dealer-manual-fallback"><summary>Thao tác tay / sửa hand</summary>{guided}</details>}
          {hook.handStarted && hook.actions.length > 0 && !hook.canUndo && <p className="dealer-undo-notice">Action trước khi tải lại không nằm trong Hoàn tác cục bộ. Dùng Báo Floor để yêu cầu sửa hand; không xóa action mù trên server.</p>}
        </> : <div className="dealer-normal-note"><h2>Chế độ thường</h2><p>Sử dụng đồng hồ cho bàn. Chọn Tracker khi Floor đã cấp quyền để nhập diễn biến hand.</p></div>}
      </aside>
    </div>
  </div>;
}
