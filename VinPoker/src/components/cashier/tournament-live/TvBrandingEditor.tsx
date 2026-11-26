import { useState } from "react";
import { useTournamentTvData } from "@/hooks/useTournamentTvData";
import { useAuth } from "@/hooks/useAuth";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";
import { TvBrandingEditorWorkspace } from "./TvBrandingEditorWorkspace";

export { TvBrandingEditorWorkspace } from "./TvBrandingEditorWorkspace";

export function TvBrandingEditor({ tournamentId }: { tournamentId: string }) {
  const { user, session } = useAuth();
  const [open, setOpen] = useState(false);
  const live = useTournamentTvData(tournamentId, { enabled: open });
  return <TvBrandingEditorWorkspace onPreviewOpenChange={setOpen} liveData={live.state === "ready" ? live.data : null} tournamentId={tournamentId} actorId={user?.id} sessionEpoch={sessionReadEpoch(session)} />;
}
