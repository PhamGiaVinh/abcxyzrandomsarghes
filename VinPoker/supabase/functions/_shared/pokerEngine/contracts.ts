// supabase/functions/_shared/pokerEngine/contracts.ts
//
// SHARED GAME STATE CONTRACT — the wire shapes exchanged between the
// authoritative server runtime and any client (web UI, Godot, admin monitor).
//
// Direction of authority (locked):
//   client  -> server : ActionRequest (INTENT ONLY — fold/check/call/bet/raise/allin)
//   server  -> client : WirePublicHandState / WirePrivateHandState / GameEventEnvelope
// The client NEVER decides cards, winner, pot, or chip balance.
//
// ── CHIP STRINGS (locked) ────────────────────────────────────────────────────
// Engine chips are `bigint`. On the wire EVERY chip amount is a DECIMAL STRING
// (`ChipString`) — never a JS number (numbers lose precision past 2^53).
// `parseChip` is the ONLY sanctioned string->bigint entry point and is strict:
// canonical non-negative decimals only ("0", "1", "250"; no sign, no leading
// zeros, no decimals/exponents/whitespace).
//
// ── SECRECY (locked) ─────────────────────────────────────────────────────────
// Wire views are built ON TOP of views.ts (toPublicView / toPrivateView), so a
// hidden hole card or the undealt deck cannot reach the wire by construction:
// WirePublicHandState has no hole-card field at all, and WirePrivateHandState
// adds back ONLY the requesting seat's own cards (`myHoleCards`).

import type {
  ActionType, Action, Card, HandEvent, HandEventType, HandState, LegalActions,
  SeatStatus, Street,
} from './types.ts';
import { legalActions } from './betting.ts';
import { toPublicView, toPrivateView } from './views.ts';
import type { PublicHandState, PublicSeat } from './views.ts';

// ── chip string codec ────────────────────────────────────────────────────────

/** A chip amount as a canonical non-negative decimal string (e.g. "0", "2500"). */
export type ChipString = string;

const CHIP_RE = /^(0|[1-9][0-9]*)$/;

export const chipToString = (amount: bigint): ChipString => amount.toString();

/**
 * Strict ChipString -> bigint. Throws on anything non-canonical: "", "-1",
 * "1.5", "1e3", "007", " 1", "abc". Use at every untrusted boundary.
 */
export function parseChip(s: string): bigint {
  if (typeof s !== 'string' || !CHIP_RE.test(s)) {
    throw new Error(`invalid chip string: ${JSON.stringify(s)}`);
  }
  return BigInt(s);
}

// ── client -> server: action intent ──────────────────────────────────────────

/**
 * The ONLY thing a client may send about a hand in progress. The server
 * re-validates everything against authoritative state before applying.
 */
export interface ActionRequest {
  handId: string;
  /** The seat the caller claims to act from; server must verify seat ownership. */
  seat: number;
  type: ActionType;
  /** bet/raise only: the TOTAL "raise to" amount (not the delta). */
  amount?: ChipString;
  /**
   * Minted by the client per ATTEMPT (UUID/ULID-strength). The server dedupes
   * on it via a durable UNIQUE constraint (online_poker_actions.idempotency_key)
   * so a retried request can never double-apply across crashes.
   */
  idempotencyKey: string;
  /** Optional optimistic-concurrency hint: the last event seq the client saw. */
  expectedSeq?: number;
}

/**
 * ActionRequest -> engine Action. Parses the chip string strictly; throws on a
 * malformed amount (callers map that to ActionRejected{code:'bad_request'}).
 */
export function actionFromRequest(req: ActionRequest): Action {
  const action: Action = { type: req.type, seat: req.seat };
  if (req.amount !== undefined) action.amount = parseChip(req.amount);
  return action;
}

// ── server -> client: action result ──────────────────────────────────────────

/** Stable machine-readable rejection categories (see classifyActionError). */
export type ActionRejectedCode =
  | 'not_in_betting'   // hand is not in a betting round
  | 'not_your_turn'    // toAct is a different seat (also: unknown seat, duplicate action)
  | 'seat_cannot_act'  // seat exists but is folded/all-in/sitting out
  | 'action_not_legal' // action type not in the legal menu (e.g. check into a bet)
  | 'amount_required'  // bet/raise sent without an amount
  | 'illegal_amount'   // bet/raise outside [minRaiseTo, maxRaiseTo]
  | 'bad_request'      // malformed request (bad chip string, bad shape) — assigned by the RPC layer
  | 'unknown';

/**
 * Map an engine rejection string (ApplyResult.error / validateAction) to a
 * stable code. The engine's strings are part of its tested contract; this is
 * the single place the RPC layer should translate them.
 */
export function classifyActionError(error: string): ActionRejectedCode {
  if (error === 'hand is not in a betting round') return 'not_in_betting';
  if (error === 'not your turn') return 'not_your_turn';
  if (error === 'seat cannot act') return 'seat_cannot_act';
  if (error.startsWith('action not legal')) return 'action_not_legal';
  if (error.endsWith('requires an amount')) return 'amount_required';
  if (error.startsWith('illegal bet size') || error.startsWith('illegal raise size')) return 'illegal_amount';
  return 'unknown';
}

export interface ActionAccepted {
  ok: true;
  handId: string;
  /** Durable seq of the LAST event this action produced (persistence-assigned). */
  seq: number;
  events: GameEventEnvelope[];
  /** The caller's fresh private view (own hole cards only). */
  view: WirePrivateHandState;
}

export interface ActionRejected {
  ok: false;
  handId: string;
  code: ActionRejectedCode;
  message: string;
}

export type ActionResult = ActionAccepted | ActionRejected;

// ── server -> client: event envelope ─────────────────────────────────────────

/**
 * A persisted public hand event. The engine emits HandEvent WITHOUT seq; the
 * persistence layer (single owner of ordering) assigns the durable per-hand
 * seq before broadcast. Payloads are PUBLIC ONLY — never a hidden card.
 */
export interface GameEventEnvelope {
  handId: string;
  seq: number;
  type: HandEventType;
  payload: Record<string, unknown>;
}

/** Stamp engine events with handId + consecutive seqs starting at `startSeq`. */
export function envelopeEvents(
  handId: string,
  startSeq: number,
  events: HandEvent[],
): GameEventEnvelope[] {
  return events.map((e, i) => ({ handId, seq: startSeq + i, type: e.type, payload: e.payload }));
}

// ── wire state views (all chips as ChipString, JSON-safe — no bigint) ────────

export interface WireHandConfig {
  handId: string;
  tableId: string;
  handNo: number;
  buttonSeat: number;
  sb: ChipString;
  bb: ChipString;
  bigBlindAnte?: ChipString;
  bigBlindAnteSeat?: number;
  schemaVersion: number;
}

/**
 * A pot partition for the wire. During `betting` this is a PROVISIONAL display
 * partition (Σ sidePots === pot) that shifts as chips go in; authoritative awards
 * live in `result.potAwards` at completion. An UNCALLED over-bet is never a real
 * pot here — the engine refunds it to the bettor's stack BEFORE the awarded pots
 * are built (see pots.ts:refundUncalled), so no `eligibleSeats` layer ever carries
 * uncalled chips at settlement.
 */
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
  /** seat number (as an object key) -> chips won this hand. */
  payouts: Record<number, ChipString>;
  /** Uncalled top of the last bet returned to its owner before any award (absent if none). */
  refund?: { seat: number; amount: ChipString };
}

export interface WirePublicSeat {
  seat: number;
  playerId: string;
  startingStack: ChipString;
  stack: ChipString;
  committed: ChipString;
  totalCommitted: ChipString;
  deadAnte?: ChipString;
  status: SeatStatus;
  hasActedThisRound: boolean;
  canRaise: boolean;
  /** PUBLIC — populated only at showdown for contesting seats. */
  revealedCards?: Card[];
  // NOTE: there is deliberately NO holeCards field on the public wire shape.
}

export interface WirePublicHandState {
  config: WireHandConfig;
  street: Street;
  board: Card[];
  seats: WirePublicSeat[];
  buttonSeat: number;
  toAct: number | null;
  currentBet: ChipString;
  lastFullRaiseSize: ChipString;
  aggressor: number | null;
  pot: ChipString;
  sidePots: WireSidePot[];
  status: HandState['status'];
  result?: WireHandResult;
}

export interface WirePrivateHandState extends WirePublicHandState {
  mySeat: number;
  /** ONLY the requesting seat's own cards. */
  myHoleCards: Card[];
}

export interface WireLegalActions {
  seat: number;
  types: ActionType[];
  toCall: ChipString;
  canCheck: boolean;
  minRaiseTo: ChipString;
  maxRaiseTo: ChipString;
}

// ── conversions (always via views.ts — secrecy by construction) ──────────────

function wireSeat(s: PublicSeat): WirePublicSeat {
  return {
    seat: s.seat,
    playerId: s.playerId,
    startingStack: chipToString(s.startingStack),
    stack: chipToString(s.stack),
    committed: chipToString(s.committed),
    totalCommitted: chipToString(s.totalCommitted),
    ...(s.deadAnte !== undefined ? { deadAnte: chipToString(s.deadAnte) } : {}),
    status: s.status,
    hasActedThisRound: s.hasActedThisRound,
    canRaise: s.canRaise,
    revealedCards: s.revealedCards ? [...s.revealedCards] : undefined,
  };
}

function wirePublicFromView(view: PublicHandState): WirePublicHandState {
  return {
    config: {
      handId: view.config.handId,
      tableId: view.config.tableId,
      handNo: view.config.handNo,
      buttonSeat: view.config.buttonSeat,
      sb: chipToString(view.config.sb),
      bb: chipToString(view.config.bb),
      ...(view.config.bigBlindAnte !== undefined ? { bigBlindAnte: chipToString(view.config.bigBlindAnte) } : {}),
      ...(view.config.bigBlindAnteSeat !== undefined ? { bigBlindAnteSeat: view.config.bigBlindAnteSeat } : {}),
      schemaVersion: view.config.schemaVersion,
    },
    street: view.street,
    board: [...view.board],
    seats: view.seats.map(wireSeat),
    buttonSeat: view.buttonSeat,
    toAct: view.toAct,
    currentBet: chipToString(view.currentBet),
    lastFullRaiseSize: chipToString(view.lastFullRaiseSize),
    aggressor: view.aggressor,
    pot: chipToString(view.pot),
    sidePots: view.sidePots.map((p) => ({ amount: chipToString(p.amount), eligibleSeats: [...p.eligibleSeats] })),
    status: view.status,
    result: view.result
      ? {
          endedBy: view.result.endedBy,
          potTotal: chipToString(view.result.potTotal),
          potAwards: view.result.potAwards.map((a) => ({
            potIndex: a.potIndex,
            amount: chipToString(a.amount),
            winners: [...a.winners],
          })),
          payouts: Object.fromEntries(
            Object.entries(view.result.payouts).map(([seat, amt]) => [seat, chipToString(amt)]),
          ),
          refund: view.result.refund
            ? { seat: view.result.refund.seat, amount: chipToString(view.result.refund.amount) }
            : undefined,
        }
      : undefined,
  };
}

/** Authoritative state -> public wire shape (no hole cards, no deck, no bigint). */
export function toWirePublicState(state: HandState): WirePublicHandState {
  return wirePublicFromView(toPublicView(state));
}

/** Authoritative state -> one seat's private wire shape (adds ONLY own cards). */
export function toWirePrivateState(state: HandState, seat: number): WirePrivateHandState {
  const priv = toPrivateView(state, seat);
  return { ...wirePublicFromView(priv), mySeat: priv.mySeat, myHoleCards: [...priv.myHoleCards] };
}

/** Legal-action menu for a seat in wire form (chips as strings). */
export function toWireLegalActions(state: HandState, seat: number): WireLegalActions {
  const la: LegalActions = legalActions(state, seat);
  return {
    seat: la.seat,
    types: [...la.types],
    toCall: chipToString(la.toCall),
    canCheck: la.canCheck,
    minRaiseTo: chipToString(la.minRaiseTo),
    maxRaiseTo: chipToString(la.maxRaiseTo),
  };
}
