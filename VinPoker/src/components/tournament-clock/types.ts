// VinPoker neon-green tournament clock — presentational contract.
// The component is locale-dumb: money/chips arrive PRE-FORMATTED as strings
// (the live mapper does VND/chip formatting in PR Clock-B). Only the small
// integer counts (players/entries/reEntries) and the second-counters are numbers.

export type PayoutRow = {
  rank: string;   // "1st", "2nd", … (pre-formatted by the caller)
  amount: string; // "120,000,000 VND" (pre-formatted)
};

export type TournamentClockData = {
  title: string;
  players: number;
  entries: number;
  reEntries: number;
  prizePool: string;
  totalChips: string;
  averageStack: string;
  levelLabel: string;          // e.g. "Level 7"
  secondsLeft: number;         // current level countdown
  terminalStatus?: 'finished' | 'cancelled';
  /** Seconds until the next scheduled break. NULL when no break is ahead —
   *  the UI then shows "--" and never a misleading 00:00 (owner P0-4). */
  nextBreakSecondsLeft: number | null;
  currentLevel: string;        // pre-formatted blinds, e.g. "1,000 / 2,000 / 2,000"
  nextLevel: string;
  payouts: PayoutRow[];
  footerNote: string;
  /** Brand name shown under the logo (per-club). Defaults to "VINPOKER" when absent. */
  brandName?: string;
  /** Club-replaceable background image. Falls back to a dark poker-room
   *  gradient when absent or on load error. */
  clubBackgroundUrl?: string | null;
  clubLogoUrl?: string | null;
  brandingLayout?: import("@/lib/tv/brandingLayout").TvBrandingLayout;
};
