import { useAuth } from "@/hooks/useAuth";
import { useTournamentTvDataCore } from "@/hooks/useTournamentTvDataCore";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";

export type { TvDataState, TvRealtimeStatus } from "@/hooks/useTournamentTvDataCore";

export function useTournamentTvData(
  tournamentId: string | undefined,
  options?: { enabled?: boolean },
) {
  const { user, session, loading } = useAuth();
  return useTournamentTvDataCore(tournamentId, {
    enabled: options?.enabled,
    userId: user?.id ?? null,
    authLoading: loading,
    authEpoch: sessionReadEpoch(session),
  });
}
