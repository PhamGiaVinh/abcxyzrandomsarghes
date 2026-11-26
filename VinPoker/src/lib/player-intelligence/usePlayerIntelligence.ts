import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { parsePlayerIntelligence, PlayerIntelligence } from "./types";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";

/**
 * Read-only access to the authenticated player's OWN verified intelligence digest.
 * Calls the player-scoped, deny-by-default RPC with NO p_player_id, so it defaults to
 * auth.uid() server-side. Never passes a player id and never uses service_role.
 */
export function usePlayerIntelligence() {
  const { user, session, loading } = useAuth();
  return useQuery<PlayerIntelligence | null>({
    queryKey: ["playerIntelligence", user?.id, sessionReadEpoch(session)],
    enabled: !!user && !loading,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_player_intelligence");
      if (error) throw error;
      return parsePlayerIntelligence(data);
    },
  });
}
