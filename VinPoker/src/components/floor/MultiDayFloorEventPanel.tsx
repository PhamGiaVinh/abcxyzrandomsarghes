import { useAuth } from "@/hooks/useAuth";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";
import { MultiDayFloorEventWorkspace, type MultiDayFloorEventProps } from "./MultiDayFloorEventWorkspace";
export { MultiDayFloorEventWorkspace } from "./MultiDayFloorEventWorkspace";
export function MultiDayFloorEventPanel(props: MultiDayFloorEventProps) {
  const { user, session } = useAuth();
  return <MultiDayFloorEventWorkspace {...props} actorId={user?.id} sessionEpoch={sessionReadEpoch(session)} />;
}
