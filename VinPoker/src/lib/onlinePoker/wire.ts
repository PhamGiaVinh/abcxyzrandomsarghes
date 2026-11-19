// src/lib/onlinePoker/wire.ts
// GE-2D — client-side mirror of the online-poker WIRE CONTRACT.
//
// These shapes MUST stay in lock-step with the server, but are re-declared here on
// purpose: the client Vite bundle must NEVER import anything under
// supabase/functions/** (the pure engine + adapter run ONLY in the Edge runtime —
// that import being impossible is the server-authoritative guardrail). So this file
// is a hand-maintained copy of:
//   * the request bodies accepted by  supabase/functions/online-poker-action/index.ts
//   * the wire view shapes in         supabase/functions/_shared/pokerEngine/contracts.ts
// If either of those changes, update this file and tests/onlinePoker/client.test.ts.
//
// Direction of authority (locked): client sends INTENT only; the server decides
// cards, winner, pot and chips and returns public/private views. There is NO
// hole-card field on the public shape — only the caller's own `myHoleCards` and
// post-showdown `revealedCards` ever appear.
//
// Chips are decimal STRINGS everywhere (JS numbers lose precision past 2^53).

import type { ActionType, SeatStatus, Street, HandStatus } from './types';

// ── chip strings ─────────────────────────────────────────────────────────────

/** A chip amount as a canonical non-negative decimal string (e.g. "0", "2500"). */
export type ChipString = string;

/** Mirrors the engine's CHIP_RE: no sign, no leading zeros, no decimals/exponents. */
const CHIP_RE = /^(0|[1-9][0-9]*)$/;

/** True iff `s` is a canonical chip string the server's `parseChip` would accept. */
export function isChipString(s: unknown): s is ChipString {
  return typeof s === 'string' && CHIP_RE.test(s);
}

// ── client -> server: action intent ──────────────────────────────────────────

/** The ONLY thing a client may send about a hand in progress (mirrors ActionRequest). */
export interface ActionRequest {
  handId: string;
  /** The seat the caller claims to act from; the server verifies seat ownership. */
  seat: number;
  type: ActionType;
  /** bet/raise only: the TOTAL "raise to" amount (not the delta), as a chip string. */
  amount?: ChipString;
  /** Minted per ATTEMPT; the server dedupes on it (durable UNIQUE). */
  idempotencyKey: string;
  /** Optional optimistic-concurrency hint: the last event seq the client saw. */
  expectedSeq?: number;
}

// ── server -> client: wire view shapes (mirror contracts.ts) ─────────────────

export interface WireHandConfig {
  handId: string;
  tableId: string;
  handNo: number;
  buttonSeat: number;
  sb: ChipString;
  bb: ChipString;
  bigBlindAnte?: ChipString;
  schemaVersion: number;
}

export interface WireSidePot {
  amount: ChipString;
  eligibleSeats: number[];
}

export interface WirePotAward {
  potIndex: number;
  amount: ChipString;
  winners: number[];
}

export interface WireHandResult {
  endedBy: 'fold' | 'showdown';
  potTotal: ChipString;
  potAwards: WirePotAward[];
  /** seat number (as object key) -> chips won this hand. */
  payouts: Record<number, ChipString>;
  /** Uncalled top returned to its owner before any award (absent if none). */
  refund?: { seat: number; amount: ChipString };
}

export interface WirePublicSeat {
  seat: number;
  playerId: string;
  startingStack: ChipString;
  stack: ChipString;
  committed: ChipString;
  totalCommitted: ChipString;
  status: SeatStatus;
  hasActedThisRound: boolean;
  canRaise: boolean;
  /** PUBLIC — populated only at showdown for contesting seats. */
  revealedCards?: string[];
  // NOTE: deliberately NO holeCards field on the public wire shape.
}

export interface WirePublicHandState {
  config: WireHandConfig;
  street: Street;
  board: string[];
  seats: WirePublicSeat[];
  buttonSeat: number;
  toAct: number | null;
  currentBet: ChipString;
  lastFullRaiseSize: ChipString;
  aggressor: number | null;
  pot: ChipString;
  sidePots: WireSidePot[];
  status: HandStatus;
  result?: WireHandResult;
}

export interface WirePrivateHandState extends WirePublicHandState {
  mySeat: number;
  /** ONLY the requesting seat's own cards. */
  myHoleCards: string[];
}

export interface WireLegalActions {
  seat: number;
  types: ActionType[];
  toCall: ChipString;
  canCheck: boolean;
  minRaiseTo: ChipString;
  maxRaiseTo: ChipString;
}

// ── server -> client: the EDGE function's actual responses ───────────────────
// NOTE: these mirror online-poker-action/index.ts, which differs from the engine's
// `ActionAccepted` (that carries seq+events; the edge returns stateVersion+view).

/** submit_action success (edge handleSubmit). */
export interface SubmitActionOk {
  ok: true;
  handId: string;
  stateVersion: number;
  view: WirePrivateHandState;
}

/** submit_action rejection — engine-classified or RPC-layer code. */
export interface SubmitActionRejected {
  ok: false;
  code: string;
  message?: string;
}

export type SubmitActionResult = SubmitActionOk | SubmitActionRejected;

/**
 * The self/passthrough RPC outcome (sit/stand/claim/hole). The edge returns the
 * RPC's raw jsonb, which is `jsonb_build_object('outcome', …, …)`. The exact extra
 * fields are pinned to migration 20260820000000 and firmed at the GE-2C apply
 * session; the client only relies on `outcome` here.
 */
export interface RpcOutcome {
  outcome: string;
  [k: string]: unknown;
}

/**
 * op_get_my_hole_cards return (mirrors migration 20260820000000):
 *   { outcome:'ok', seat, cards }  |  { outcome:'unauthenticated'|'disabled'|'not_seated' }
 */
export type HoleCardsOutcome =
  | { outcome: 'ok'; seat: number; cards: string[] }
  | { outcome: 'unauthenticated' | 'disabled' | 'not_seated' };

export function isHoleCardsOk(x: RpcOutcome): x is { outcome: 'ok'; seat: number; cards: string[] } {
  return x.outcome === 'ok' && typeof (x as { seat?: unknown }).seat === 'number'
    && Array.isArray((x as { cards?: unknown }).cards);
}

/** Any edge transport-level failure carries `{ error }` (never secret text — G1). */
export interface EdgeError {
  error: string;
}

export function isEdgeError(x: unknown): x is EdgeError {
  return !!x && typeof x === 'object' && typeof (x as EdgeError).error === 'string';
}
