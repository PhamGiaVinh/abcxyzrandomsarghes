// supabase/functions/_shared/pokerEngine/hand.ts
// Hand lifecycle orchestrator: createHand (deck INJECTED), applyAction (the
// re-validating reducer), street advance + all-in runout, fold-to-one, showdown
// hand-off, and forcedTimeoutAction. applyAction is PURE: it deep-clones the
// input and returns a new state, never mutating its argument.

import type {
  ApplyResult, Action, Card, HandConfig, HandEvent, HandState, SeatInput, SeatState,
} from './types.ts';
import { assertNoDuplicates } from './deck.ts';
import {
  applyBettingAction, firstClockwiseFrom, nextActorAfter, validateAction,
} from './betting.ts';
import { computeSidePots, refundUncalled } from './pots.ts';
import { evaluateShowdown } from './showdown.ts';
import {
  blindsPosted, boardRevealed, handComplete, handStarted, holeCardsDealt, potAwarded,
  streetAdvanced, uncalledReturned,
} from './events.ts';

export const SCHEMA_VERSION = 1;

const isInHand = (s: SeatState) => s.status === 'active' || s.status === 'allin';
const isActive = (s: SeatState) => s.status === 'active';

function cloneSeat(s: SeatState): SeatState {
  return {
    ...s,
    holeCards: [...s.holeCards],
    revealedCards: s.revealedCards ? [...s.revealedCards] : undefined,
  };
}

export function cloneState(state: HandState): HandState {
  return {
    config: { ...state.config },
    street: state.street,
    board: [...state.board],
    seats: state.seats.map(cloneSeat),
    buttonSeat: state.buttonSeat,
    toAct: state.toAct,
    currentBet: state.currentBet,
    lastFullRaiseSize: state.lastFullRaiseSize,
    aggressor: state.aggressor,
    pot: state.pot,
    sidePots: state.sidePots.map((p) => ({ amount: p.amount, eligibleSeats: [...p.eligibleSeats] })),
    status: state.status,
    result: state.result
      ? {
          ...state.result,
          potAwards: state.result.potAwards.map((a) => ({ ...a, winners: [...a.winners] })),
          payouts: { ...state.result.payouts },
          // nested object: must be copied, or clones would share (and could mutate) it
          ...(state.result.refund ? { refund: { ...state.result.refund } } : {}),
        }
      : undefined,
    deck: [...state.deck],
  };
}

function commit(state: HandState, s: SeatState, amount: bigint): void {
  s.stack -= amount;
  s.committed += amount;
  s.totalCommitted += amount;
  state.pot += amount;
  if (s.stack === 0n && s.status === 'active') s.status = 'allin';
}

// ── createHand ───────────────────────────────────────────────────────────────

export function createHand(
  config: Omit<HandConfig, 'schemaVersion'> & { schemaVersion?: number },
  deck: Card[],
  seatInputs: SeatInput[],
): ApplyResult {
  assertNoDuplicates(deck);

  const seats: SeatState[] = seatInputs.map((si) => ({
    seat: si.seat,
    playerId: si.playerId,
    startingStack: si.stack,
    stack: si.stack,
    committed: 0n,
    totalCommitted: 0n,
    status: si.sittingOut || si.stack <= 0n ? 'sitting_out' : 'active',
    hasActedThisRound: false,
    canRaise: true,
    holeCards: [],
  }));

  const active = seats.filter(isActive).sort((a, b) => a.seat - b.seat);
  if (active.length < 2) throw new Error('createHand needs >= 2 active seats');

  const needed = active.length * 2 + 5;
  if (deck.length < needed) throw new Error(`deck too small: need ${needed}, got ${deck.length}`);

  // Tournament dead-button placement (optional + additive). When present it is the
  // single source of truth for the button seat (which may be an EMPTY/dead seat).
  const blindPlacement = config.blindPlacement;
  const ante = config.bigBlindAnte ?? 0n;
  if (ante < 0n) throw new Error('big blind ante must be non-negative');
  const cfg: HandConfig = {
    handId: config.handId,
    tableId: config.tableId,
    handNo: config.handNo,
    buttonSeat: blindPlacement ? blindPlacement.buttonSeat : config.buttonSeat,
    sb: config.sb,
    bb: config.bb,
    ...(ante > 0n ? { bigBlindAnte: ante } : {}),
    schemaVersion: config.schemaVersion ?? SCHEMA_VERSION,
    ...(blindPlacement ? { blindPlacement } : {}),
  };

  const state: HandState = {
    config: cfg,
    street: 'preflop',
    board: [],
    seats,
    buttonSeat: cfg.buttonSeat,
    toAct: null,
    currentBet: 0n,
    lastFullRaiseSize: cfg.bb,
    aggressor: null,
    pot: 0n,
    sidePots: [],
    status: 'betting',
    deck: [...deck],
  };

  // blind seats
  const findActiveAfter = (from: number) =>
    firstClockwiseFrom(seats, from, false, isActive)!;
  let sbSeat: SeatState | null;
  let bbSeat: SeatState;
  if (blindPlacement) {
    // Tournament: the BB is always a live seat; the SB may be DEAD (its physical
    // seat is empty) in which case NO small blind is posted. The button may also
    // sit on an empty seat — it is just a marker and posts nothing.
    const bb = seats.find((s) => s.seat === blindPlacement.bbSeat && isActive(s));
    if (!bb) throw new Error(`blindPlacement.bbSeat ${blindPlacement.bbSeat} is not an active seat`);
    bbSeat = bb;
    if (blindPlacement.sbSeat == null) {
      sbSeat = null; // dead SB
    } else {
      const sb = seats.find((s) => s.seat === blindPlacement.sbSeat && isActive(s));
      if (!sb) throw new Error(`blindPlacement.sbSeat ${blindPlacement.sbSeat} is not an active seat`);
      if (sb.seat === bbSeat.seat) throw new Error('blindPlacement SB and BB are the same seat');
      sbSeat = sb;
    }
  } else if (active.length === 2) {
    sbSeat = seats.find((s) => s.seat === cfg.buttonSeat)!; // heads-up: button is SB
    bbSeat = findActiveAfter(cfg.buttonSeat);
  } else {
    sbSeat = findActiveAfter(cfg.buttonSeat);
    bbSeat = findActiveAfter(sbSeat.seat);
  }

  if (sbSeat) commit(state, sbSeat, sbSeat.stack < cfg.sb ? sbSeat.stack : cfg.sb);
  commit(state, bbSeat, bbSeat.stack < cfg.bb ? bbSeat.stack : cfg.bb);
  const antePaid = bbSeat.stack < ante ? bbSeat.stack : ante;
  if (antePaid > 0n) {
    commit(state, bbSeat, antePaid);
    bbSeat.committed -= antePaid;
    bbSeat.deadAnte = antePaid;
  }
  state.currentBet = cfg.bb;
  state.lastFullRaiseSize = cfg.bb;
  state.aggressor = bbSeat.seat;

  // deal 2 hole cards each, one at a time, clockwise from the SB position (cards
  // consumed off deck front). The deal ring is the PRE-BLIND active list: posting a
  // blind can put a short seat all-in, but an all-in-from-the-blinds seat is still
  // dealt in. (GE-1.6 fix: walking post-blind 'active' statuses mis-dealt when a
  // blind went all-in.) With a DEAD SB the SB seat is empty, so dealing starts at
  // the next live seat clockwise — the BB.
  let di = 0;
  const dealOrder = (() => {
    const anchor = (sbSeat ?? bbSeat).seat;
    const start = active.findIndex((s) => s.seat === anchor);
    return active.map((_, i) => active[(start + i) % active.length]);
  })();
  for (let round = 0; round < 2; round++) {
    for (const s of dealOrder) s.holeCards.push(state.deck[di++]);
  }
  state.deck = state.deck.slice(di);

  // first to act preflop = first active seat left of BB (UTG); heads-up => SB(button)
  const firstToAct = firstClockwiseFrom(seats, bbSeat.seat, false, isActive);
  state.toAct = firstToAct ? firstToAct.seat : null;

  const events: HandEvent[] = [
    handStarted(cfg.handId, cfg.buttonSeat, active.map((s) => s.seat)),
    blindsPosted(
      sbSeat ? sbSeat.seat : null,
      bbSeat.seat,
      sbSeat ? cfg.sb.toString() : '0',
      cfg.bb.toString(),
      ante > 0n ? antePaid.toString() : undefined,
    ),
    holeCardsDealt(active.map((s) => s.seat)),
  ];

  // edge: everyone all-in from blinds (no one can act) => run it out immediately
  if (state.toAct === null) events.push(...closeRoundAndAdvance(state));

  refreshSidePots(state);
  return { state, events };
}

/** Live pot partition for display/audit; the conserved quantity stays Σ(stacks)+pot. */
function refreshSidePots(state: HandState): void {
  state.sidePots = state.status === 'betting' ? computeSidePots(state) : [];
}

// ── street advance / runout ──────────────────────────────────────────────────

const REVEAL: Record<string, number> = { flop: 3, turn: 1, river: 1 };

/** Reveals the next street's board from the deck. Returns the new street. */
function advanceStreetOnce(state: HandState, events: HandEvent[]): void {
  const next: Record<string, HandState['street']> = {
    preflop: 'flop', flop: 'turn', turn: 'river', river: 'showdown',
  };
  const ns = next[state.street];
  state.street = ns;
  events.push(streetAdvanced(ns));
  const n = REVEAL[ns];
  if (n) {
    const cards = state.deck.slice(0, n);
    state.deck = state.deck.slice(n);
    state.board.push(...cards);
    events.push(boardRevealed(ns, cards));
  }
}

function firstActivePostflop(state: HandState): number | null {
  const s = firstClockwiseFrom(state.seats, state.buttonSeat, false, isActive);
  if (s) return s.seat;
  // Dead button: the button sits on an empty seat absent from `seats`, so the
  // clockwise scan found no anchor. Fall back to the physical ring — the first
  // active seat whose number exceeds the (empty) button seat, wrapping to the
  // lowest active seat. (Cash play never reaches here: its button is a real seat.)
  const actives = state.seats.filter(isActive).sort((a, b) => a.seat - b.seat);
  if (actives.length === 0) return null;
  return (actives.find((x) => x.seat > state.buttonSeat) ?? actives[0]).seat;
}

const countActiveWithChips = (state: HandState) =>
  state.seats.filter((s) => s.status === 'active').length;

/** Close the current betting round, advance streets (running out if no betting is possible), and resolve showdown. */
function closeRoundAndAdvance(state: HandState): HandEvent[] {
  const events: HandEvent[] = [];
  // reset per-street metadata; pot stays gross
  for (const s of state.seats) {
    s.committed = 0n;
    if (s.status === 'active') { s.hasActedThisRound = false; s.canRaise = true; }
  }
  state.currentBet = 0n;
  state.lastFullRaiseSize = state.config.bb;
  state.aggressor = null;
  state.toAct = null;

  while (true) {
    advanceStreetOnce(state, events);
    if (state.street === 'showdown') {
      events.push(...evaluateShowdown(state));
      return events;
    }
    if (countActiveWithChips(state) >= 2) {
      const next = firstActivePostflop(state);
      if (next !== null) {
        state.toAct = next; // betting continues on this street
        return events;
      }
      // nobody able to act though >=2 have chips (shouldn't happen) -> keep running out
    }
    // else: <=1 seat can bet -> run out the remaining streets
  }
}

// ── fold-to-one ──────────────────────────────────────────────────────────────

function awardFoldToOne(state: HandState, seatNo: number): HandEvent[] {
  const refund = refundUncalled(state);
  // Close the street metadata exactly like closeRoundAndAdvance does, so a
  // fold-to-one completed state never carries stale per-street accounting
  // (a refunded raiser would otherwise show committed > totalCommitted).
  for (const s of state.seats) {
    s.committed = 0n;
    if (s.status === 'active') { s.hasActedThisRound = false; s.canRaise = true; }
  }
  state.currentBet = 0n;
  state.lastFullRaiseSize = state.config.bb;
  state.aggressor = null;
  const winner = state.seats.find((s) => s.seat === seatNo)!;
  const amount = state.pot;
  winner.stack += amount;
  state.pot -= amount; // -> 0
  state.toAct = null;
  state.street = 'complete';
  state.status = 'complete';
  const awards = [{ potIndex: 0, amount, winners: [seatNo] }];
  state.result = {
    endedBy: 'fold',
    potTotal: amount,
    potAwards: awards,
    payouts: { [seatNo]: amount },
  };
  if (refund) state.result.refund = { ...refund };
  // fold-to-one NEVER reveals the winner's cards
  const events: HandEvent[] = refund ? [uncalledReturned(refund.seat, refund.amount)] : [];
  events.push(potAwarded(awards), handComplete('fold', amount));
  return events;
}

// ── applyAction (public reducer) ─────────────────────────────────────────────

export function applyAction(prev: HandState, action: Action): ApplyResult {
  const err = validateAction(prev, action);
  if (err) return { state: prev, events: [], error: err };

  const state = cloneState(prev);
  const events = applyBettingAction(state, action);

  const inHand = state.seats.filter(isInHand);
  if (inHand.length === 1) {
    events.push(...awardFoldToOne(state, inHand[0].seat));
    refreshSidePots(state);
    return { state, events };
  }

  state.toAct = nextActorAfter(state, action.seat);
  if (state.toAct === null) events.push(...closeRoundAndAdvance(state));

  refreshSidePots(state);
  return { state, events };
}

// ── forced timeout ───────────────────────────────────────────────────────────

/** Auto-action when a seat's clock expires: check if free, else fold. (Disconnect/grace policy is Phase-2.) */
export function forcedTimeoutAction(state: HandState, seat: number): Action {
  const s = state.seats.find((x) => x.seat === seat);
  const toCall = s ? state.currentBet - s.committed : 1n;
  return toCall <= 0n ? { type: 'check', seat } : { type: 'fold', seat };
}
