import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import type { HandPlayerDisplay } from "./handPlayerNames";

type HandPlayerNamesClient = SupabaseClient<Database>;
type SeatDisplayRow = Pick<Database["public"]["Tables"]["tournament_seats"]["Row"], "player_id" | "player_name" | "avatar_url">;
type ProfileDisplayRow = Pick<Database["public"]["Tables"]["profiles"]["Row"], "user_id" | "display_name" | "avatar_url">;

// This resolver is intentionally injected for the Ops/Floor boundary. The legacy
// resolver keeps its application client for existing viewer callers; this file never
// imports it, so the Ops bundle cannot cross into the player application shell.
const snapshotProbes = new WeakMap<HandPlayerNamesClient, Promise<boolean>>();

export function handPlayersHasSnapshotForClient(client: HandPlayerNamesClient): Promise<boolean> {
  const cached = snapshotProbes.get(client);
  if (cached) return cached;
  const probe = (async () => {
    const { error } = await client.from("hand_players").select("player_name").limit(1);
    if (!error) return true;
    // Only a confirmed absent column selects the legacy read path. Network/auth
    // failures must reach the workspace error state, not poison this client cache.
    if (error.code === "42703") return false;
    throw new Error(error.message || "Không xác minh được dữ liệu snapshot của hand.");
  })().catch((error: unknown) => {
    snapshotProbes.delete(client);
    throw error;
  });
  snapshotProbes.set(client, probe);
  return probe;
}

export async function fetchHandPlayerDisplayForClient(
  client: HandPlayerNamesClient,
  tournamentId: string | undefined | null,
  playerIds: string[],
  options: { includeProfiles?: boolean } = {},
): Promise<Map<string, HandPlayerDisplay>> {
  const map = new Map<string, HandPlayerDisplay>();
  const ids = [...new Set(playerIds)].filter(Boolean);
  if (!tournamentId || ids.length === 0) return map;

  const withAvatar = await client
    .from("tournament_seats")
    .select("player_id, player_name, avatar_url")
    .eq("tournament_id", tournamentId)
    .in("player_id", ids);

  let rows: SeatDisplayRow[] = withAvatar.data ?? [];
  if (withAvatar.error) {
    const { data: fallbackRows } = await client
      .from("tournament_seats")
      .select("player_id, player_name")
      .eq("tournament_id", tournamentId)
      .in("player_id", ids);
    rows = (fallbackRows ?? []).map((seat) => ({ ...seat, avatar_url: null }));
  }

  rows.forEach((seat) => {
    map.set(seat.player_id, { name: seat.player_name || undefined, avatar: seat.avatar_url ?? null });
  });

  const missingProfileIds = options.includeProfiles ? ids.filter((playerId) => !map.get(playerId)?.name) : [];
  if (missingProfileIds.length > 0) {
    const { data: profiles } = await client
      .from("profiles")
      .select("user_id, display_name, avatar_url")
      .in("user_id", missingProfileIds);
    (profiles ?? [] as ProfileDisplayRow[]).forEach((profile) => {
      if (!profile.display_name && !profile.avatar_url) return;
      const current = map.get(profile.user_id);
      map.set(profile.user_id, {
        name: current?.name ?? profile.display_name ?? undefined,
        avatar: current?.avatar ?? profile.avatar_url ?? null,
      });
    });
  }
  return map;
}
