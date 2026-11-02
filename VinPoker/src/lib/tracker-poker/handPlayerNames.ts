// Shared resolver for a RECORDED hand's player display name + avatar.
//
// Recorded-hand rows (hand_players / hand_actions) key players by `player_id`, which
// EQUALS `tournament_seats.player_id` (both bare UUID, unique per tournament — proven
// by start_hand copying ts.player_id into hand_players, record_hand writing the payload
// player_id sourced from tournament_seats, and record_hand's own elimination step
// joining tournament_seats ON player_id = hand_players.player_id). For walk-in / offline
// players that id is a synthetic gen_random_uuid() that does NOT exist in
// profiles.user_id — so the old `profiles.user_id IN (player_ids)` joins always missed
// and names fell back to the raw 6-char id. Names/avatars must come from
// tournament_seats.player_name / avatar_url (the SAME source the LIVE felt uses).
import { supabase } from "@/integrations/supabase/client";

export interface HandPlayerDisplay {
  /** tournament_seats.player_name, or undefined when the seat row is gone (busted). */
  name?: string;
  /** tournament_seats.avatar_url, or null. */
  avatar?: string | null;
}

// ── E1 snapshot feature-detect ───────────────────────────────────────────────
// hand_players.player_name / avatar_url (the historical snapshot, migration
// 20261224000000) may not exist yet if the owner-gated apply hasn't run. Probe ONCE
// (cached) so the read sites can add the columns to their select only when present —
// selecting a missing column would 42703 the whole query and break the hand load. The
// Successful/confirmed missing-column results are memoised; failed reads retry.
let snapshotProbe: Promise<boolean> | null = null;
export function handPlayersHasSnapshot(): Promise<boolean> {
  if (!snapshotProbe) {
    snapshotProbe = (async () => {
      const { error } = await supabase.from("hand_players").select("player_name").limit(1);
      if (!error) return true;
      if (error.code === "42703") return false;
      throw new Error(error.message || "Không xác minh được dữ liệu snapshot của hand.");
    })().catch((error: unknown) => {
      snapshotProbe = null;
      throw error;
    });
  }
  return snapshotProbe;
}

/** Test-only: reset the cached probe. */
export function __resetHandPlayersSnapshotProbe(): void {
  snapshotProbe = null;
}

/**
 * Map player_id → { name, avatar } for a recorded hand's players, read from
 * tournament_seats (NOT profiles). Not filtered by is_active, so eliminated players
 * still resolve while their seat row exists. avatar_url may be absent on some
 * deployments → falls back to selecting player_name only. Callers keep their own
 * `id.slice(0,6)` fallback for players whose seat row no longer exists.
 */
export async function fetchHandPlayerDisplay(
  tournamentId: string | undefined | null,
  playerIds: string[],
  options: { includeProfiles?: boolean } = {},
): Promise<Map<string, HandPlayerDisplay>> {
  const map = new Map<string, HandPlayerDisplay>();
  const ids = [...new Set(playerIds)].filter(Boolean);
  if (!tournamentId || ids.length === 0) return map;

  const withAvatar = await supabase
    .from("tournament_seats")
    .select("player_id, player_name, avatar_url")
    .eq("tournament_id", tournamentId)
    .in("player_id", ids);

  const rows = withAvatar.error
    ? (
        await supabase
          .from("tournament_seats")
          .select("player_id, player_name")
          .eq("tournament_id", tournamentId)
          .in("player_id", ids)
      ).data
    : withAvatar.data;

  (rows ?? []).forEach((s: any) => {
    map.set(s.player_id, { name: s.player_name || undefined, avatar: s.avatar_url ?? null });
  });

  const missingProfileIds = options.includeProfiles ? ids.filter((playerId) => !map.get(playerId)?.name) : [];
  if (missingProfileIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, display_name, avatar_url")
      .in("user_id", missingProfileIds);
    (profiles ?? []).forEach((profile) => {
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
