import type { TvData, TvLevel, TvPrize, TvTournamentStatus } from "@/types/tv";
import { computeNextBreak } from "@/lib/tv/computeNextBreak";
import { parseSatellitePayout } from "@/lib/satellitePayout";
import { parseTvBrandingLayout } from "@/lib/tv/brandingLayout";
import { FEATURES } from "@/lib/featureFlags";

// Raw shapes coming back from existing reads — no schema change in PR B.

/** Level object inside the get_tournament_clock JSONB payload. */
export interface ClockRpcLevel {
  id?: string;
  level_number: number;
  small_blind: number;
  big_blind: number;
  ante: number;
  duration_minutes: number;
  is_break: boolean;
}

/** get_tournament_clock JSONB payload (migration 20260608000001). */
export interface ClockRpcPayload {
  error?: string;
  message?: string;
  tournament_id?: string;
  status?: string;
  is_running?: boolean;
  elapsed_seconds?: number;
  remaining_seconds?: number;
  current_level?: ClockRpcLevel | null;
  is_break?: boolean;
  next_level?: ClockRpcLevel | null;
}

export interface TvTournamentRow {
  name: string;
  status: string;
  players_remaining: number | null;
  average_stack: number | null;
  prize_pool: number | null;
  starting_stack: number | null;
  guarantee_amount: number | null;
  main_event?: { guarantee_amount: number | null } | null;
  buy_in: number | null;
  rake_amount: number | null;
  satellite_payout: unknown;
  club: {
    name: string;
    cover_url: string | null;
    tv_logo_url: string | null;
    tv_brand_name: string | null;
    tv_bg_url: string | null;
    tv_layout_config?: unknown;
  } | null;
}

export interface TvLevelRow {
  level_number: number;
  small_blind: number;
  big_blind: number;
  ante: number;
  duration_minutes: number;
  is_break: boolean;
}

export interface TvPrizeRow {
  position: number;
  amount: number | string;
}

export interface TvDataSources {
  clock: ClockRpcPayload;
  tournament: TvTournamentRow;
  levels: TvLevelRow[];
  /** Canonical participation entry count, independent of registration receipts. */
  totalEntries: number;
  totalChips?: number;
  /** SUM(buy_in) of confirmed registrations; null when the read failed. */
  totalBuyIns: number | null;
  /** Canonical re-entry generation count; null when unavailable. */
  reEntries: number | null;
  prizes: TvPrizeRow[];
  /** Drift-corrected remaining seconds to display (clockAnchor.displayedRemaining). */
  displayRemainingSeconds: number;
}

/** DB tournaments.status → TvTournamentStatus. Unknown/pre-start values render as "scheduled". */
export function mapTournamentStatus(dbStatus: string | null | undefined): TvTournamentStatus {
  switch (dbStatus) {
    case "live":
    case "active":
    case "break":
      return "live";
    case "final_table":
      return "final_table";
    case "finished":
    case "completed":
      return "finished";
    case "cancelled":
      return "cancelled";
    default:
      return "scheduled"; // upcoming | registering | drawing | unknown
  }
}

export function mapClockLevel(level: ClockRpcLevel | null | undefined): TvLevel | null {
  if (!level) return null;
  return {
    levelNumber: level.level_number,
    smallBlind: level.small_blind,
    bigBlind: level.big_blind,
    ante: level.ante,
    durationMinutes: level.duration_minutes,
    isBreak: level.is_break,
  };
}

export function mapLevelRows(rows: TvLevelRow[]): TvLevel[] {
  return rows
    .map((row) => ({
      levelNumber: row.level_number,
      smallBlind: row.small_blind,
      bigBlind: row.big_blind,
      ante: row.ante,
      durationMinutes: row.duration_minutes,
      isBreak: row.is_break,
    }))
    .sort((a, b) => a.levelNumber - b.levelNumber);
}

function mapPrizes(rows: TvPrizeRow[]): TvPrize[] {
  return rows
    .map((row) => ({ position: row.position, amount: Number(row.amount) }))
    .filter((prize) => Number.isFinite(prize.amount) && prize.amount > 0)
    .sort((a, b) => a.position - b.position);
}

/**
 * Compose every live read into the frozen TvData contract (PR A).
 * Pure — all fetching, anchoring, and ticking happen in useTournamentTvData.
 */
export function mapTvData(sources: TvDataSources): TvData {
  const { clock, tournament, displayRemainingSeconds } = sources;
  const currentLevel = mapClockLevel(clock.current_level);
  const levels = mapLevelRows(sources.levels);
  const status = mapTournamentStatus(tournament.status);
  const terminal = status === 'finished' || status === 'cancelled';

  return {
    tournamentName: tournament.name,
    clubName: tournament.club?.name ?? "",
    clubLogoUrl: tournament.club?.tv_logo_url ?? null,
    brandingLayout: FEATURES.tvLayoutEditorV1
      ? parseTvBrandingLayout(tournament.club?.tv_layout_config)
      : undefined,
    brandName: tournament.club?.tv_brand_name ?? tournament.club?.name ?? null,
    eventNote: null, // no schema column yet — hidden by contract
    status,
    isRunning: !terminal && (clock.is_running ?? false),
    isBreak: !terminal && (clock.is_break ?? currentLevel?.isBreak ?? false),
    remainingSeconds: terminal ? 0 : displayRemainingSeconds,
    currentLevel,
    nextLevel: terminal ? null : mapClockLevel(clock.next_level),
    nextBreakSeconds: terminal ? null : computeNextBreak(levels, currentLevel?.levelNumber, displayRemainingSeconds),
    playersRemaining: tournament.players_remaining ?? 0,
    totalEntries: sources.totalEntries,
    reEntries: sources.reEntries,
    averageStack: tournament.average_stack ?? 0,
    totalChips: sources.totalChips,
    totalBuyIns: sources.totalBuyIns,
    prizePool: tournament.prize_pool != null ? Number(tournament.prize_pool) : null,
    prizePoolIsCanonical: true,
    guarantee: tournament.guarantee_amount != null ? Number(tournament.guarantee_amount) : null,
    mainEventGuarantee: typeof tournament.main_event?.guarantee_amount === 'number'
      && Number.isSafeInteger(tournament.main_event.guarantee_amount) && tournament.main_event.guarantee_amount >= 0
      ? tournament.main_event.guarantee_amount : null,
    prizes: mapPrizes(sources.prizes),
    sponsorText: null,
    startingStack: tournament.starting_stack != null ? Number(tournament.starting_stack) : 0,
    buyIn: tournament.buy_in != null ? Number(tournament.buy_in) : null,
    rakeAmount: tournament.rake_amount != null ? Number(tournament.rake_amount) : null,
    clubCoverUrl: tournament.club?.tv_bg_url ?? tournament.club?.cover_url ?? null,
    satellitePayout: parseSatellitePayout(tournament.satellite_payout),
  };
}
