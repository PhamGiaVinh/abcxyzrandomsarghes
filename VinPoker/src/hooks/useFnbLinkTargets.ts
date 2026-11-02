import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { FEATURES } from "@/lib/featureFlags";
import { useAuth } from "./useAuth";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";

export type FnbLinkTable = { id: string; table_name: string; status: string };
export type FnbLinkPlayer = {
  player_id: string; name: string; table_id: string | null; table_name: string | null; seat_number: number;
  seat_id?: string; entry_id?: string; table_session_id?: string; tournament_table_id?: string; tournament_id?: string;
};
export type FnbLinkTargets = { tables: FnbLinkTable[]; players: FnbLinkPlayer[]; unavailable_player_count?: number; unavailable_table_count?: number };

/**
 * A2 picker data source — reads real club tables + seated players in the club's LIVE tournaments via
 * the SECURITY DEFINER `fnb_list_link_targets` RPC. F&B cashiers cannot read `game_tables` /
 * `tournament_tables` directly under RLS (gated to dealer-control/admin/owner); this RPC reads them on
 * the caller's behalf without widening any RLS policy. Reporting labels ONLY — no chip/bank/debt data.
 * Only verified current table/session/entry relations are selectable. Unavailable counts keep
 * legacy operational inconsistencies visible rather than presenting a falsely healthy empty list.
 */
export function useFnbLinkTargets(clubId: string | undefined) {
  const {user,session,loading:authLoading}=useAuth();
  const actor=authLoading?undefined:user?.id;
  const epoch=sessionReadEpoch(session);
  return useQuery({
    queryKey: ["fnb", "linkTargets", clubId, actor, epoch],
    enabled: !!actor && !!clubId && FEATURES.fnbTableLink,
    queryFn: async (): Promise<FnbLinkTargets> => {
      const { data, error } = await supabase.rpc("fnb_list_link_targets", { p_club_id: clubId });
      if (error) throw error;
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("Không xác minh được danh sách bàn/người chơi.");
      }
      if (data.error) throw new Error(String(data.error));
      if (!Array.isArray(data.tables) || !Array.isArray(data.players)) {
        throw new Error("Không xác minh được danh sách bàn/người chơi.");
      }
      const unavailable: Pick<FnbLinkTargets,'unavailable_player_count'|'unavailable_table_count'> = {};
      for (const key of ['unavailable_player_count','unavailable_table_count'] as const) {
        const count = data[key];
        if (count === undefined) continue;
        if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
          throw new Error('Không xác minh được số bàn/người chơi cần xử lý.');
        }
        unavailable[key] = count;
      }
      return { tables: data.tables as FnbLinkTable[], players: data.players as FnbLinkPlayer[],
        ...unavailable };
    },
  });
}
