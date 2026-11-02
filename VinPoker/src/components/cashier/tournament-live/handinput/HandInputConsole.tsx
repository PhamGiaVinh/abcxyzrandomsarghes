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
import { PendingFinishControls } from './PendingFinishControls';
import {AllInConfirmation} from './AllInConfirmation';
import {VoidConfirmation} from './VoidConfirmation';

export function HandInputConsole({ tournamentId }: { tournamentId: string }) {
  const hook = useStandaloneHandInput(tournamentId);
  return <TrackerInputCardProvider>
    <PendingFinishControls hook={hook}/>
    <AllInConfirmation hook={hook}/>
    <VoidConfirmation hook={hook}/>
    {FEATURES.trackerRacetrackUi ? (
    <RacetrackHandInputConsole hook={hook} />
  ) : (
    <StandaloneHandInputConsole hook={hook} />
  )}</TrackerInputCardProvider>;
}
