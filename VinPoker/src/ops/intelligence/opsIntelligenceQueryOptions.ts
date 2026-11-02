import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { getSeriesClubLivePulseV1WithClient } from "@/lib/series-intelligence/seriesClubLivePulseClient";
import { loadOpsLiveOperations } from "./opsLiveOperationsAdapter";
import { loadOpsRegistrationPaceQ0, loadOpsSepayReadStateQ0 } from "./opsQuantDataHealthAdapter";
import type { OpsSourceAvailabilityV1 } from "./opsIntelligenceReadModel";
import { observeTrackerContextRead } from '@/lib/tournament/observeTrackerContextRead';

export type OpsIntelligenceClient = SupabaseClient<Database>;

export type OpsReadEnvelope<T> = {
  readonly value: T | null;
  readonly availability: OpsSourceAvailabilityV1;
  readonly observedAt: string;
  readonly reasonCode: string | null;
};

export function pulseQueryOptions(client: OpsIntelligenceClient, clubId: string) {
  return {
    refetchInterval: 5_000,
    refetchOnWindowFocus: 'always' as const,
    refetchOnReconnect: 'always' as const,
    queryKey: ["ops", clubId, "intelligence", "pulse"] as const,
    queryFn: async (): Promise<OpsReadEnvelope<Awaited<ReturnType<typeof getSeriesClubLivePulseV1WithClient>>>> => {
      const result = await observeTrackerContextRead(getSeriesClubLivePulseV1WithClient(client, clubId));
      const observedAt = new Date().toISOString();
      if ("error" in result) {
        return Object.freeze({ value: result, availability: "unavailable", observedAt, reasonCode: result.error });
      }
      return Object.freeze({ value: result, availability: "exact", observedAt, reasonCode: null });
    },
  };
}

export function operationsQueryOptions(client: OpsIntelligenceClient, clubId: string, q0Enabled: boolean) {
  return {
    refetchInterval: 5_000,
    refetchOnWindowFocus: 'always' as const,
    refetchOnReconnect: 'always' as const,
    queryKey: ["ops", clubId, "intelligence", "operations", q0Enabled ? "q0" : "v1"] as const,
    queryFn: () => observeTrackerContextRead(loadOpsLiveOperations(client, clubId, { q0CapacityTruth: q0Enabled })),
  };
}

export function registrationQ0QueryOptions(client: OpsIntelligenceClient, clubId: string) {
  return {
    refetchInterval: 5_000,
    refetchOnWindowFocus: 'always' as const,
    refetchOnReconnect: 'always' as const,
    queryKey: ["ops", clubId, "quant-q0", "registration"] as const,
    queryFn: () => observeTrackerContextRead(loadOpsRegistrationPaceQ0(client, clubId)),
  };
}

export function sepayQ0QueryOptions(client: OpsIntelligenceClient, clubId: string) {
  return {
    refetchInterval: 5_000,
    refetchOnWindowFocus: 'always' as const,
    refetchOnReconnect: 'always' as const,
    queryKey: ["ops", clubId, "quant-q0", "sepay"] as const,
    queryFn: () => observeTrackerContextRead(loadOpsSepayReadStateQ0(client, clubId)),
  };
}
