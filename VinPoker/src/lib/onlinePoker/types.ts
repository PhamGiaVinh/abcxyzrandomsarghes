// src/lib/onlinePoker/types.ts
// GE-2D shell — client-side PUBLIC view types for online poker.
//
// These MIRROR the server's WirePublicHandState (the JSON persisted in
// online_poker_hands.state) but are defined LOCALLY on purpose: the client bundle
// must never import the engine/adapter under supabase/functions/** (the engine
// runs only in the Edge runtime; the client sends intent and renders public state).
//
// Conventions that match the server contract:
//   * chips are decimal STRINGS, never JS numbers (precision is lost past 2^53);
//   * cards are 2-char strings like "Ah" / "Td"; the public view never carries a
//     hidden hole card — only `revealedCards` (showdown) and the caller's own
//     `myHoleCards` (fetched separately via op_get_my_hole_cards) ever appear.

/** Hard in-shell gate. While false the table is mock-only and EVERY action is
 *  disabled. Flips true only when the GE-2C runtime (migration 20260820000000 +
 *  online_poker_config.enabled) is live AND the client is wired to it.
 *  ON (closed alpha 2026-06-17): runtime migrations live, edge deployed.
 *  online_poker_config.enabled=true is set via separate controlled DB op before
 *  gameplay; while still false the edge returns disabled gracefully. */
export const RUNTIME_LIVE = true;

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'complete';
export type SeatStatus = 'empty' | 'sitting_out' | 'active' | 'allin' | 'folded';
export type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';
export type HandStatus = 'dealing' | 'betting' | 'complete' | 'voided';
export type TableStatus = 'open' | 'paused' | 'closed';

export interface PublicSeatView {
  seat: number;
  playerId: string | null;
  displayName?: string;
  /** chip string */
  stack: string;
  /** chip string — committed THIS street */
  committed: string;
  status: SeatStatus;
  /** PUBLIC; present only after a legitimate showdown reveal. */
  revealedCards?: string[];
  isButton?: boolean;
  isToAct?: boolean;
}

/** A single (main or side) pot award — mirrors the server wire `WirePotAward`. */
export interface PublicPotAward {
  potIndex: number;
  /** chip string */
  amount: string;
  /** seat numbers that won this pot (split = more than one) */
  winners: number[];
}

/**
 * Settlement summary for a COMPLETED hand — the server-authoritative result the
 * client renders (it never computes this). Mirrors the wire `WireHandResult`; the
 * client only reads winner / pot / refund to announce the outcome.
 */
export interface PublicHandResult {
  endedBy: 'fold' | 'showdown';
  /** chip string — total chips awarded this hand */
  potTotal: string;
  potAwards: PublicPotAward[];
  /** seat number (object key) -> chips won this hand */
  payouts: Record<number, string>;
  /** uncalled top returned to its owner before any award (absent if none) */
  refund?: { seat: number; amount: string };
}

export interface PublicHandView {
  handId: string;
  tableId: string;
  handNo: number;
  blinds?: { sb: string; bb: string; bigBlindAnte?: string };
  street: Street;
  /** revealed community cards only */
  board: string[];
  /** chip string */
  pot: string;
  toActSeat: number | null;
  buttonSeat: number;
  status: HandStatus;
  seats: PublicSeatView[];
  /** Server settlement summary — present once the hand is complete. */
  result?: PublicHandResult;
  /** PRIVATE overlay: the caller's OWN hole cards. Never another seat's. */
  myHoleCards?: string[];
  mySeat?: number;
}

export interface LobbyTableSummary {
  id: string;
  name: string;
  /** chip strings */
  sb: string;
  bb: string;
  maxSeats: number;
  seatedCount: number;
  status: TableStatus;
}

/** A play-chip wallet snapshot (mock in the shell; op_claim/sit/stand later). */
export interface WalletView {
  balance: string;
  /** UTC date string of last daily grant, if any. */
  lastGrantDay?: string;
}
