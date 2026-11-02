import { useAuth } from "@/hooks/useAuth";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";
import { FloorRedrawWorkspaceV1, type RedrawProps } from "./FloorRedrawWorkspaceV1";
export function FloorRedrawDialogV1(props: RedrawProps) {
  const { user, session } = useAuth();
  return <FloorRedrawWorkspaceV1 {...props} actorId={session ? user?.id : undefined} sessionEpoch={sessionReadEpoch(session)} />;
}
