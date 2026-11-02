import type { OpsIntelligenceClient } from "./opsIntelligenceQueryOptions";
import { parseOpsIntelligenceContextV1 } from "./opsIntelligenceContextV1";
import { observeTrackerContextRead } from '@/lib/tournament/observeTrackerContextRead';

type ContextRpcClient = { rpc(name: "get_ops_intelligence_context_v1", params: { p_club_id: string }): PromiseLike<{ data: unknown; error: unknown }> };

export function contextQueryOptions(client: OpsIntelligenceClient, clubId: string) {
  return {
    queryKey: ["ops", clubId, "intelligence", "context-v1"] as const,
    refetchInterval: 5_000,
    refetchOnWindowFocus: 'always' as const,
    refetchOnReconnect: 'always' as const,
    queryFn: async () => {
      const { data, error } = await observeTrackerContextRead((client as unknown as ContextRpcClient).rpc("get_ops_intelligence_context_v1", { p_club_id: clubId }));
      if (error) throw new Error("CONTEXT_READ_UNAVAILABLE");
      const value = parseOpsIntelligenceContextV1(data, clubId);
      return { value, observedAt: new Date().toISOString() };
    },
  };
}
