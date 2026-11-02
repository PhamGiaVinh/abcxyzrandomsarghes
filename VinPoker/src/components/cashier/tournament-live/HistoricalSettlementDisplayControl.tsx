import { useAuth } from "@/hooks/useAuth";
import { HistoricalSettlementDisplayWorkspace, type HistoricalSettlementDisplayControlProps } from "./HistoricalSettlementDisplayWorkspace";

export { HistoricalSettlementDisplayWorkspace } from "./HistoricalSettlementDisplayWorkspace";

export function HistoricalSettlementDisplayControl(props: HistoricalSettlementDisplayControlProps) {
  const { user } = useAuth();
  return <HistoricalSettlementDisplayWorkspace {...props} actorId={user?.id} />;
}
