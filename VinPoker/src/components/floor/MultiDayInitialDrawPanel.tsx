import { useAuth } from "@/hooks/useAuth";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";
import { MultiDayInitialDrawWorkspace } from "./MultiDayInitialDrawWorkspace";
export { MultiDayInitialDrawWorkspace } from "./MultiDayInitialDrawWorkspace";
export function MultiDayInitialDrawPanel({ eventId }: { eventId: string }) {
  const { user, session } = useAuth();
  return <MultiDayInitialDrawWorkspace eventId={eventId} actorId={user?.id} sessionEpoch={sessionReadEpoch(session)} />;
}
