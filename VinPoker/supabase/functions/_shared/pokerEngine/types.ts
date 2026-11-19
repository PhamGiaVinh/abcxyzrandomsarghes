// supabase/functions/_shared/pokerEngine/types.ts
//
// Pure types for the VinPoker No-Limit Hold'em rules engine.
// ZERO external imports. Imported by Deno (Edge), the future actor server, and
// Vitest — NEVER by the client (the @engine alias is vitest-only on purpose).
//
// ── CHIP TYPE (locked) ────────────────────────────────────────────────────
// All chip/pot/stack amounts are `bigint` internally — never `number`, never
// float (a JS number loses precision past 2^53 and rounds money). Any future
// persistence or transport layer MUST serialize chips as DECIMAL STRINGS
// (e.g. amount.toString()), never as a JS number. See views.ts:serializeForTransport.
//
// ── POT / COMMITTED CONVENTION (locked) ───────────────────────────────────
// `pot` is the running GROSS pot and ALREADY INCLUDES every chip committed on
// the current street (chips are swept into `pot` the instant they leave a stack).
// `committed` (this street) and `totalCommitted` (all streets) are ACCOUNTING
// METADATA used only for legal-action sizing and side-pot construction.
// NEVER compute total chips as `stack + pot + committed` — that double-counts.
// The one conservation invariant is:   Σ(seat.stack) + pot === initialTotal.

export type Rank = 'A' | 'K' | 'Q' | 'J' | 'T' | '9' | '8' | '7' | '6' | '5' | '4' | '3' | '2';
export type Suit = 's' | 'h' | 'd' | 'c';
/** Rank-first, lowercase suit. Mirrors CardSlot.tsx + validate_cards(). e.g. "As" "Td" "2c" */
export type Card = `${Rank}${Suit}`;

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'complete';

/**
 * empty/sitting_out  — not dealt into the hand.
 * active             — in the hand, has chips, may still act.
 * allin              — in the hand, no chips behind, cannot act, can still win.
 * folded             — out of the hand, cannot win.
 */
export type SeatStatus = 'empty' | 'sitting_out' | 'active' | 'allin' | 'folded';

export type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';

export interface Action {
  type: ActionType;
  seat: number;
  /** bet/raise: the TOTAL "raise to" amount (not the delta). Ignored for fold/check/call/allin. */
  amount?: bigint;
}

/** Lean input shape used to seed a hand; createHand derives the full SeatState. */
export interface SeatInput {
  seat: number;        // 1-based seat index
  playerId: string;
  stack: bigint;       // chips behind at sit-down
  sittingOut?: boolean;
}

export interface SeatState {
  seat: number;
  playerId: string;
  startingStack: bigint;   // stack at the start of THIS hand
  stack: bigint;           // chips currently behind
  committed: bigint;       // chips put in on the CURRENT street (metadata)
  totalCommitted: bigint;  // chips put in across ALL streets, including any dead ante
  deadAnte?: bigint;       // posted BBA; belongs to the main pot and cannot be refunded
  status: SeatStatus;
  hasActedThisRound: boolean;
  /** Right to RAISE this round. Cleared for already-acted seats by a sub-min all-in (no-reopen rule). */
  canRaise: boolean;
  /** PRIVATE — exactly 0 or 2 cards. Must NEVER appear in a public view/event. */
  holeCards: Card[];
  /** PUBLIC — populated only at showdown for contesting seats (mucked/folded stay null). */
  revealedCards?: Card[];
}

export interface SidePot {
  amount: bigint;
  /** seat numbers eligible to win THIS pot — never includes a folded seat. */
  eligibleSeats: number[];
}

/**
 * Resolved tournament ("dead" / forward-moving button) blind placement for ONE hand.
 * Produced by button.ts:nextButtonTournament and consumed by createHand when present
 * on HandConfig.blindPlacement. Unlike cash play, the button and/or SB seat may land
 * on an EMPTY (busted) physical seat — only the BB is guaranteed to be a live seat.
 * Absent => createHand uses the legacy cash placement (button is always a live seat,
 * SB/BB are the next live seats clockwise). This shape is OPTIONAL + additive: a hand
 * without it behaves byte-for-byte as before.
 */
export interface TournamentBlindPlacement {
  /** The button seat — may be an EMPTY/busted seat (dead button). */
  buttonSeat: number;
  /** The small-blind seat, or null when the SB position is empty (DEAD SB — no SB posted). */
  sbSeat: number | null;
  /** The big-blind seat — ALWAYS a live seat. */
  bbSeat: number;
  deadButton: boolean;
  deadSb: boolean;
}

export interface HandConfig {
  handId: string;
  tableId: string;
  handNo: number;
  buttonSeat: number;
  sb: bigint;
  bb: bigint;
  /** Explicit tournament option. The big blind is posted before this ante. */
  bigBlindAnte?: bigint;
  /** STATE-SHAPE version (NOT a CAS counter). Bump when the HandState JSON shape changes. */
  schemaVersion: number;
  /**
   * OPTIONAL tournament dead-button placement. When present, createHand posts the
   * BB always + the SB only if its seat is live, and the button may sit on an empty
   * seat. When ABSENT (default), the legacy cash placement runs unchanged. Not part
   * of the wire config (WireHandConfig) — it is an authoritative server-side input.
   */
  blindPlacement?: TournamentBlindPlacement;
}

export interface PotAward {
  potIndex: number;        // index into the side-pot list (0 = main pot)
  amount: bigint;
  winners: number[];       // seat numbers that split this pot
}

export interface HandResult {
  endedBy: 'fold' | 'showdown';
  potTotal: bigint;                  // total distributed (pot value before payout)
  potAwards: PotAward[];
  payouts: Record<number, bigint>;   // seat -> chips won this hand
  /** Uncalled top of the last bet returned to its owner BEFORE any award (absent if none). */
  refund?: { seat: number; amount: bigint };
}

/**
 * Full AUTHORITATIVE hand state. Contains private data (deck, holeCards) that
 * MUST be stripped before broadcast — use views.ts:toPublicView / toPrivateView.
 */
export interface HandState {
  config: HandConfig;
  street: Street;
  board: Card[];                 // only REVEALED community cards
  seats: SeatState[];
  buttonSeat: number;
  toAct: number | null;          // seat to act, or null when the round is closed
  currentBet: bigint;            // highest `committed` on the current street
  lastFullRaiseSize: bigint;     // size of the last FULL bet/raise (min-raise + no-reopen)
  aggressor: number | null;      // seat that made the last full bet/raise
  pot: bigint;                   // running GROSS pot (includes current-street committed)
  sidePots: SidePot[];
  status: 'dealing' | 'betting' | 'complete';
  result?: HandResult;
  /** PRIVATE — undealt cards (board to come). MUST be stripped from any public view. */
  deck: Card[];
}

export type HandEventType =
  | 'hand_started'
  | 'blinds_posted'
  | 'hole_cards_dealt'   // PUBLIC: announces dealing only, carries NO cards
  | 'action'
  | 'street_advanced'
  | 'board_revealed'     // carries ONLY the just-revealed community cards
  | 'uncalled_returned'  // unmatched top of the last bet went back to its owner (pot -> stack)
  | 'pot_awarded'
  | 'showdown'           // carries ONLY revealed cards of CONTESTING seats
  | 'hand_complete';

/** Engine emits events WITHOUT seq; the persistence layer assigns the durable per-hand seq. */
export interface HandEvent {
  type: HandEventType;
  payload: Record<string, unknown>;  // PUBLIC ONLY — never a hidden hole card or unrevealed board card
}

export interface LegalActions {
  seat: number;
  types: ActionType[];
  toCall: bigint;      // chips needed to call (0 => check is available)
  canCheck: boolean;
  minRaiseTo: bigint;  // smallest legal "raise to" (0 if raising is not allowed)
  maxRaiseTo: bigint;  // NL cap = committed + stack (0 if raising is not allowed)
}

export interface ApplyResult {
  state: HandState;
  events: HandEvent[];
  /** Set => action REJECTED; `state` is returned unchanged. */
  error?: string;
}
