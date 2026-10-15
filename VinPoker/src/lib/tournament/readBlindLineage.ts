import { supabase } from "@/integrations/supabase/client";
import { observeTrackerContextRead } from "./observeTrackerContextRead";

export interface RecordedBlindLineage {
  previousDealtSeats: number[];
  previousButtonSeat: number;
  previousSbPosition: number;
  previousBbSeat: number;
}

export interface RecordedBlindLevel {
  level_number: number;
  small_blind: number;
  big_blind: number;
  ante: number;
}

/** The level frozen by the server when Start Hand inserted this hand. */
export async function readHandBlindLevel(handId: string): Promise<RecordedBlindLevel | null> {
  const { data, error } = await supabase.from("tournament_hands")
    .select("tracker_level_number,tracker_small_blind,tracker_big_blind,tracker_bba")
    .eq("id", handId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("tracker_hand_blind_snapshot_missing");
  const row = data as unknown as {
    tracker_level_number: number | null;
    tracker_small_blind: number | null;
    tracker_big_blind: number | null;
    tracker_bba: number | null;
  };
  if (row.tracker_level_number == null && row.tracker_small_blind == null
    && row.tracker_big_blind == null && row.tracker_bba == null) return null;
  if (row.tracker_level_number == null || row.tracker_small_blind == null
    || row.tracker_big_blind == null || row.tracker_bba == null) {
    throw new Error("tracker_hand_blind_snapshot_incomplete");
  }
  if (![row.tracker_level_number, row.tracker_small_blind,
    row.tracker_big_blind, row.tracker_bba].every(Number.isInteger)
    || row.tracker_level_number < 1 || row.tracker_small_blind <= 0
    || row.tracker_big_blind < row.tracker_small_blind || row.tracker_bba < 0) {
    throw new Error("tracker_hand_blind_snapshot_invalid");
  }
  return {
    level_number: row.tracker_level_number,
    small_blind: row.tracker_small_blind,
    big_blind: row.tracker_big_blind,
    ante: row.tracker_bba,
  };
}

/** Read a completed hand's blind evidence, including pre-migration blind posts. */
export async function readBlindLineage(handId: string): Promise<RecordedBlindLineage | null> {
  const [handResult, actionResult, playerResult] = await Promise.all([
    supabase.from("tournament_hands")
      .select("button_seat,status,is_voided,tracker_sb_position,tracker_bb_position")
      .eq("id", handId).maybeSingle(),
    supabase.from("hand_actions")
      .select("player_id,entry_number,action_type")
      .eq("hand_id", handId).in("action_type", ["post_sb", "post_bb"]),
    supabase.from("hand_players")
      .select("player_id,entry_number,seat_number")
      .eq("hand_id", handId),
  ]);
  if (handResult.error || actionResult.error || playerResult.error) {
    throw handResult.error ?? actionResult.error ?? playerResult.error;
  }
  if (!handResult.data) return null;
  const hand = handResult.data as unknown as {
    button_seat: number | null;
    status: string;
    is_voided: boolean | null;
    tracker_sb_position: number | null;
    tracker_bb_position: number | null;
  };
  if (hand.status !== "completed" || hand.is_voided) return null;
  const posts = actionResult.data ?? [];
  const players = playerResult.data ?? [];
  const previousDealtSeats = [...new Set(players.map((player) => player.seat_number))].sort((left, right) => left - right);
  const postedSeat = (type: "post_sb" | "post_bb"): number | null => {
    const matched = posts.filter((action) => action.action_type === type);
    if (matched.length !== 1) return null;
    const player = players.find((row) => row.player_id === matched[0].player_id
      && row.entry_number === matched[0].entry_number);
    return player?.seat_number ?? null;
  };
  const postedSb = postedSeat("post_sb");
  const postedBb = postedSeat("post_bb");
  const sb = hand.tracker_sb_position ?? postedSb;
  const bb = hand.tracker_bb_position ?? postedBb;
  if (postedSb !== null && sb !== postedSb) return null;
  if (postedBb !== null && bb !== postedBb) return null;
  if (hand.button_seat == null || sb == null || bb == null || postedBb == null
    || previousDealtSeats.length < 2 || !previousDealtSeats.includes(bb)) return null;
  return { previousDealtSeats, previousButtonSeat: hand.button_seat, previousSbPosition: sb, previousBbSeat: bb };
}

export type BlindLineageRead = { available: true; lineage: RecordedBlindLineage | null } | { available: false };

/** A follow-up read cannot turn an already committed Finish into a failed writer. */
export async function readBlindLineageState(handId: string): Promise<BlindLineageRead> {
  try { return { available: true, lineage: await observeTrackerContextRead(readBlindLineage(handId)) }; }
  catch { return { available: false }; }
}
