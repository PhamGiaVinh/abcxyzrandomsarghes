import { useAuth } from "@/hooks/useAuth";
import { HistoricalSettlementBatchWorkspace, type HistoricalSettlementBatchProps } from "./HistoricalSettlementBatchWorkspace";

export { HistoricalSettlementBatchWorkspace } from "./HistoricalSettlementBatchWorkspace";

export function HistoricalSettlementBatchControl(props: HistoricalSettlementBatchProps) {
  const { user } = useAuth();
  return <HistoricalSettlementBatchWorkspace {...props} actorId={user?.id} />;
}
