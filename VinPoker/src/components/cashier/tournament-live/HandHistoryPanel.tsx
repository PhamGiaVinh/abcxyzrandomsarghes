import { HandHistoryWorkspace, type HandHistoryPanelProps } from "./HandHistoryWorkspace";
import { useAuth } from "@/hooks/useAuth";

export type { HandHistoryPanelProps, HandHistorySelection } from "./HandHistoryWorkspace";
export { ResettlePreview } from "./HandHistoryWorkspace";

// Application and Ops shells both provide their authenticated client through the
// context seam. Keep the public panel name stable for existing routes.
export function HandHistoryPanel(props: HandHistoryPanelProps) {
  const { user } = useAuth();
  return <HandHistoryWorkspace {...props} actorId={user?.id} />;
}
