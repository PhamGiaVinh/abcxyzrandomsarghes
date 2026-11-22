import { useState } from "react";
import { LiveFelt, formatActionLabel } from "@/components/cashier/tournament-live/LiveFelt";
import { TrackerVisualStyles } from "@/components/cashier/tournament-live/PokerVisuals";
import { formatViewerBB } from "@/lib/tracker-poker/viewerAmounts";
import { ActionDock } from "./ActionDock";
import { ActionShotClock } from "./ActionShotClock";
import { TrackerInputCardProvider, TrackerViewerCardProvider } from "./TrackerCardStyle";
import { TrackerRacetrack } from "./TrackerRacetrack";
import { DealerVoiceReadout } from "./voice/DealerVoiceReadout";
import { BLINDS, STAGES, previewHand, type Stage } from "./tableModePreviewFixture";
import { formatChips } from "./constants";
import type { ActionIntent, SeatVM } from "./types";

const MODES = [
  { id: "spectator", label: "Khán giả" },
  { id: "manual", label: "Chỉ nhập tay" },
  { id: "voice", label: "Mic + tay" },
] as const;
type Mode = typeof MODES[number]["id"];

const control = "min-h-11 rounded-lg border border-border bg-card px-3 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary";
const modeButton = control + " aria-pressed:border-primary aria-pressed:text-primary";
const amountLabel = (amount: number) => formatViewerBB(amount, BLINDS.bb);

function PreviewVoice({ actor, toCall, onConfirm }: {
  actor: SeatVM; toCall: number; onConfirm: () => void;
}) {
  const [heard, setHeard] = useState<"idle" | "partial" | "final">("idle");
  const partial = "Ghế " + actor.seatNumber;
  const phrase = partial + (toCall ? " · Call " + formatChips(toCall) : " · Check");
  return <section className="space-y-2 rounded-xl border border-emerald-300/25 bg-emerald-950/40 p-3">
    <DealerVoiceReadout statusLabel="Mic mô phỏng" partial={heard === "partial" ? partial : ""} finalTranscript={heard === "final" ? phrase : ""} />
    <div className="flex flex-wrap gap-2">
      {heard !== "final"
        ? <button type="button" className={control} onClick={() => setHeard(heard === "idle" ? "partial" : "final")}>{heard === "idle" ? "Thử câu mẫu" : "Kết thúc câu"}</button>
        : <>
          <button type="button" className={control} onClick={onConfirm}>Xác nhận {phrase}</button>
          <button type="button" className={control} onClick={() => setHeard("idle")}>Nói lại</button>
        </>}
    </div>
  </section>;
}

export function TrackerInputPreview() {
  const [mode, setMode] = useState<Mode>("manual");
  const [stage, setStage] = useState<Stage>("river");
  const [intent, setIntent] = useState<ActionIntent | null>(null);
  const hand = previewHand(stage, intent, new URLSearchParams(window.location.search).has("allbets"));
  const actor = hand.actor;
  const selectStage = (value: Stage) => {
    setStage(value);
    setIntent(null);
  };
  return <main className="tracker-table-preview mx-auto min-h-screen w-full max-w-6xl space-y-3 bg-background px-3 py-4 text-foreground sm:px-5">
    <TrackerVisualStyles />
    <header className="preview-table-head">
      <div><div className="text-xs font-medium text-muted-foreground">Bàn mẫu · Dữ liệu mô phỏng</div>
        <h1 className="mt-1 text-xl font-bold">Bàn 09 <span className="font-normal text-muted-foreground">/ Hand #14</span></h1>
      </div>
      <label className="flex items-center gap-2 text-sm">Vòng chơi
        <select className={control} value={stage} onChange={(e) => selectStage(e.target.value as Stage)}>
          {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </label>
    <nav aria-label="Giao diện bàn mẫu" className="flex flex-wrap gap-2">
      {MODES.map((m) => <button key={m.id} type="button" aria-pressed={mode === m.id} className={modeButton}
        onClick={() => setMode(m.id)}>{m.label}</button>)}
    </nav>
    </header>
    {mode === "spectator" ? <TrackerViewerCardProvider>
      <LiveFelt seats={hand.seats} lastActorId={hand.lastAction?.player_id ?? null} toActId={actor?.playerId}
        displayCards={hand.board} potSize={hand.breakdown.totalCommitted} potBreakdown={hand.breakdown}
        latestAction={hand.lastAction} multiTableUnresolved={false} handNumber={14} blinds={BLINDS} buttonSeat={9}
        formatBB={amountLabel} viewerBigBlind={BLINDS.bb} viewerAmountsInBB viewerLayout compact tableFx />
    </TrackerViewerCardProvider> : <TrackerInputCardProvider>
      <TrackerRacetrack seats={hand.dealerSeats} actingSeatNumber={actor?.seatNumber ?? null} engineToActSeatNumber={actor?.seatNumber} dealerSeatNumber={9}
        boardCards={hand.board} blinds={BLINDS} pot={hand.breakdown.totalCommitted} potBreakdown={hand.breakdown}
        bigBlind={BLINDS.bb} rich betChips dealerFix feltV2 belowBoard={actor && <ActionShotClock key={stage} playerLabel={actor.name} />} />
      {mode === "voice" && actor && <PreviewVoice key={`voice-${stage}`} actor={actor} toCall={hand.toCall} onConfirm={() => setIntent({
        action: hand.toCall ? "call" : "check", seatNumber: actor.seatNumber, amount: (actor.committed ?? 0) + hand.toCall,
      })} />}
      {actor && <ActionDock key={`manual-${stage}`} actingSeat={actor} toCall={hand.toCall} bigBlind={BLINDS.bb} onIntent={setIntent} onUndo={() => setIntent(null)} />}
      {hand.lastAction && <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3">
        <span role="status">Ghế {hand.lastAction.seat_number} · {formatActionLabel(hand.lastAction)}</span>
        <button type="button" className={control} onClick={() => setIntent(null)}>Hoàn tác mẫu</button>
      </div>}
      {stage === "runout" && <p className="text-center text-sm text-muted-foreground">Đã all-in · Chờ chia pot.</p>}
    </TrackerInputCardProvider>}
  </main>;
}

export default TrackerInputPreview;
