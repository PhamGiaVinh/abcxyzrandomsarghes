// TvData is the frozen contract between the TV display (PR A, mock)
// and the live data hook useTournamentTvData (PR B).
// Nullable/optional fields render as hidden when absent — the TV must
// never show placeholders for data the schema does not have yet.

import type { SatellitePayout } from "@/lib/satellitePayout";
import type { TvBrandingLayout } from "@/lib/tv/brandingLayout";

export interface TvLevel {
  levelNumber: number;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  durationMinutes: number;
  isBreak: boolean;
}

export interface TvPrize {
  position: number;
  amount: number;
}

export type TvTournamentStatus =
  | "scheduled"
  | "live"
  | "final_table"
  | "finished"
  | "cancelled";

export interface TvData {
  tournamentName: string;
  clubName: string;
  clubLogoUrl?: string | null;
  /** Sanitized per-club positioning/font controls. */
  brandingLayout?: TvBrandingLayout;
  /** Per-club brand name shown under the logo on the clock (clubs.tv_brand_name,
   *  fallback club name). Defaults to "VINPOKER" in the clock when absent. */
  brandName?: string | null;
  /** Free-text note, e.g. "Hết đăng ký đầu Level 11". Hidden when null. */
  eventNote?: string | null;
  status: TvTournamentStatus;
  isRunning: boolean;
  isBreak: boolean;
  remainingSeconds: number;
  currentLevel: TvLevel | null;
  nextLevel: TvLevel | null;
  /** Seconds until the next scheduled break starts. Null when no break ahead. */
  nextBreakSeconds: number | null;
  playersRemaining: number;
  totalEntries: number;
  reEntries: number | null;
  averageStack: number;
  /** Exact canonical live-entry stack total; absent only in legacy/mock data. */
  totalChips?: number;
  /** Sum of confirmed buy-ins (VND). Null until wired to live data. */
  totalBuyIns: number | null;
  prizePool: number | null;
  /** A server read-model value: preserve explicit zero/unknown, never estimate. */
  prizePoolIsCanonical?: boolean;
  guarantee?: number | null;
  /** One promise for the whole Main Event; never a flight prize-pool fallback. */
  mainEventGuarantee?: number | null;
  prizes: TvPrize[];
  sponsorText?: string | null;
  /** Tournament starting stack (chips) — used to derive total chips in play. */
  startingStack: number;
  /** Per-entry buy-in / rake (VND) — feed a prize-pool estimate when prize_pool is stale. */
  buyIn: number | null;
  rakeAmount: number | null;
  /** Club cover photo (clubs.cover_url) → the broadcast clock's replaceable background. */
  clubCoverUrl?: string | null;
  /** Cơ cấu satellite nhập tay (vé + tiền) từ tournaments.satellite_payout. Null = không dùng. */
  satellitePayout?: SatellitePayout | null;
}
