import { useAuth } from "@/hooks/useAuth";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";
import { TvBrandingEditorWorkspace } from "./TvBrandingEditorWorkspace";

export { TvBrandingEditorWorkspace } from "./TvBrandingEditorWorkspace";

export function TvBrandingEditor({ tournamentId }: { tournamentId: string }) {
  const { user, session } = useAuth();
  return <TvBrandingEditorWorkspace tournamentId={tournamentId} actorId={user?.id} sessionEpoch={sessionReadEpoch(session)} />;
}
