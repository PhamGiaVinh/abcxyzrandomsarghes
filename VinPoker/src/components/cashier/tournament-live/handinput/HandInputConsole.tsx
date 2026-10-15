// The operator Hand Input console, embeddable. Owns the controller hook and picks
// the presentation: racetrack (TrackerRacetrack felt + ActionDock) when
// FEATURES.trackerRacetrackUi is ON, else the LiveFelt-based standalone. BOTH use
// the SAME useStandaloneHandInput hook + guided sub-panels, so the engine behaviour
// is identical — only the felt + action step differ.
//
// Used by BOTH the full-screen page (`/tracker/hand-input`) and the embedded operator
// "Nhập hand" tab (TournamentLivePanel) so the two never drift.

import { FEATURES } from "@/lib/featureFlags";
import { useStandaloneHandInput } from "./useStandaloneHandInput";
import { StandaloneHandInputConsole } from "./StandaloneHandInputConsole";
import { RacetrackHandInputConsole } from "./RacetrackHandInputConsole";
import { TrackerInputCardProvider } from "@/components/tracker/TrackerCardStyle";
import { Button } from "@/components/ui/button";

export function HandInputConsole({ tournamentId }: { tournamentId: string }) {
  const hook = useStandaloneHandInput(tournamentId);
  return <TrackerInputCardProvider>
    {hook.pendingFinishError && <p role="alert" className="border border-destructive p-3 text-sm">{hook.pendingFinishError}</p>}
    {hook.pendingFinish && <div role="status" className="flex flex-wrap items-center gap-2 border border-border bg-muted p-3 text-sm">
      <span>Finish đang chờ xác minh. Không gửi yêu cầu mới khi chưa rõ kết quả.</span>
      <Button variant="outline" size="sm" disabled={hook.submitting} onClick={hook.handleCancelPendingFinish}>
        Hủy yêu cầu Finish (không void hand)
      </Button>
    </div>}
    {FEATURES.trackerRacetrackUi ? (
    <RacetrackHandInputConsole hook={hook} />
  ) : (
    <StandaloneHandInputConsole hook={hook} />
  )}</TrackerInputCardProvider>;
}
