// ═══════════════════════════════════════════════════════════════════════════════
// Tournament & Swing Config Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface Tournament {
  id: string;
  club_id: string;
  name: string;
  description: string | null;
  status: "upcoming" | "registering" | "drawing" | "live" | "break" | "final_table" | "completed" | "cancelled";
  swing_duration_minutes: number;
  warn_at_minutes: number;
  crit_at_minutes: number;
  created_at: string;
  updated_at: string;
  // Live tracker fields
  current_level: number | null;
  current_blinds: string | null;
  current_level_id: string | null;
  clock_started_at: string | null;
  clock_paused_at: string | null;
  pause_accumulated: number | null;
  players_remaining: number | null;
  average_stack: number | null;
  prize_pool: number | null;
  itm_places: number | null;
}

export interface TournamentTable {
  id: string;
  tournament_id: string;
  table_id: string;
  created_at: string;
}

export interface TournamentWithTables extends Tournament {
  tournament_tables: {
    id?: string;
    table_id: string | null;
    game_table_id?: string | null;
    table_session_id?: string | null;
    status?: string;
    canonical_game_table?: {
      id: string;
      table_name: string;
    } | null;
    game_tables?: {
      id: string;
      table_name: string;
    } | null;
  }[];
  tournament_levels?: Pick<TournamentLevel, "level_number" | "is_break">[];
}

export interface TournamentLevel {
  id: string;
  tournament_id: string;
  level_number: number;
  small_blind: number;
  big_blind: number;
  ante: number;
  duration_minutes: number;
  is_break: boolean;
  created_at: string;
}

export interface TournamentSeat {
  id: string;
  tournament_id: string;
  player_id: string;
  entry_number: number;
  table_id: string;
  seat_number: number;
  chip_count: number;
  is_active: boolean;
  created_at: string;
}

export interface TournamentHand {
  id: string;
  tournament_id: string;
  table_id: string;
  hand_number: number;
  hand_time: string;
  side_pots: any[];
  community_cards: string[];
  pot_size: number;
  is_voided?: boolean;
  created_at: string;
}

export interface HandPlayer {
  id: string;
  hand_id: string;
  tournament_id: string;
  player_id: string;
  entry_number: number;
  seat_number: number;
  starting_stack: number;
  ending_stack: number;
  is_eliminated: boolean;
  side_pots: any[];
  created_at: string;
}

export type PokerStreet = "preflop" | "flop" | "turn" | "river";

export interface HandAction {
  id: string;
  hand_id: string;
  player_id: string;
  entry_number: number;
  action_type: string;
  action_amount: number;
  action_order: number;
  street: PokerStreet;
  created_at: string;
}

export interface TournamentChipCount {
  id: string;
  tournament_id: string;
  player_id: string;
  entry_number: number;
  chip_count: number;
  updated_at: string;
}

export interface TournamentElimination {
  id: string;
  tournament_id: string;
  player_id: string;
  entry_number: number;
  hand_id: string;
  position: number;
  prize: number;
  created_at: string;
}

export interface TournamentStateTransition {
  id: string;
  tournament_id: string;
  previous_state: string;
  new_state: string;
  changed_at: string;
  changed_by: string | null;
  reason: string | null;
}

export interface TournamentPrize {
  id: string;
  tournament_id: string;
  position: number;
  percentage: number;
  amount: number;
  created_at: string;
}

export interface TournamentLeaderboardPlayer {
  player_id: string;
  player_name?: string;
  entry_number: number;
  chip_count: number;
  is_active: boolean | null;
  position: number;
  prize: number;
  is_itm: boolean;
  table_id: string | null;
  seat_number: number | null;
}

export interface TournamentLeaderboard {
  tournament_id: string;
  players_remaining: number;
  itm_places: number;
  average_stack: number | null;
  prize_pool: number | null;
  players: TournamentLeaderboardPlayer[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Swing Config Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface SwingConfigOverride {
  id: string;
  club_id: string;
  scope_type: "club" | "table";
  scope_id: string | null;
  swing_duration_minutes: number;
  warn_at_minutes: number;
  crit_at_minutes: number;
  created_at: string;
  updated_at: string;
}

export interface EffectiveSwingConfig {
  swing_duration_minutes: number;
  warn_at_minutes: number;
  crit_at_minutes: number;
  source: "table" | "tournament" | "club" | "club_legacy" | "default";
}

/** Input shape for creating/updating swing config */
export interface SwingConfigInput {
  swing_duration_minutes: number;
  warn_at_minutes: number;
  crit_at_minutes: number;
}
