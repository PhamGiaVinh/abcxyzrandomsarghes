// supabase/functions/_shared/pokerAdapter/serialize.ts
//
// GE-2C — lossless split/merge between the authoritative engine HandState and
// its persisted form:
//   PUBLIC  -> online_poker_hands.state          (wire projection; NO deck, NO hole cards; chips as strings)
//   SECRET  -> online_poker_hand_secrets          (live remaining deck + per-seat hole cards)
//
// The pure engine ships serializeForTransport (bigint -> decimal string) but NO
// deserializer; this module is that missing half. The public projection is built
// ONLY via toWirePublicState, so a hidden hole card or the undealt deck cannot
// reach the stored public state by construction. Deserialization rebuilds the
// bigint HandState by parsing ONLY the known chip fields through the strict
// parseChip, then asserts structural invariants (fail-closed).

import type {
  Card, HandState, SeatState, SidePot, HandResult, PotAward,
} from '../pokerEngine/types.ts';
import { BBA_STATE_SCHEMA_VERSION, SCHEMA_VERSION, toWirePublicState, parseChip, checkInvariants } from '../pokerEngine/index.ts';
import type {
  WirePublicHandState, WirePublicSeat, WireSidePot, WireHandResult,
} from '../pokerEngine/index.ts';

/** A seat's private hole cards, stored as online_poker_hand_secrets(kind='hole'). */
export interface SeatHole {
  seat: number;
  cards: Card[];
}

export interface AuthoritativeSplit {
  /** PUBLIC wire projection -> online_poker_hands.state (jsonb). No deck, no hole cards. */
  stateJson: WirePublicHandState;
  /** SECRET — the live remaining deck -> online_poker_hand_secrets(kind='board_future'). */
  liveDeck: Card[];
  /** SECRET — per-seat hole cards (only seats that were dealt) -> kind='hole'. */
  holes: SeatHole[];
}

/** Split authoritative state into a public projection + the secret deck/holes. */
export function serializeAuthoritative(state: HandState): AuthoritativeSplit {
  return {
    stateJson: toWirePublicState(state),
    liveDeck: [...state.deck],
    holes: state.seats
      .filter((s) => s.holeCards.length > 0)
      .map((s) => ({ seat: s.seat, cards: [...s.holeCards] })),
  };
}

function seatFromWire(ws: WirePublicSeat, holesBySeat: Record<number, Card[]>): SeatState {
  const hole = holesBySeat[ws.seat];
  return {
    seat: ws.seat,
    playerId: ws.playerId,
    startingStack: parseChip(ws.startingStack),
    stack: parseChip(ws.stack),
    committed: parseChip(ws.committed),
    totalCommitted: parseChip(ws.totalCommitted),
    ...(ws.deadAnte !== undefined ? { deadAnte: parseChip(ws.deadAnte) } : {}),
    status: ws.status,
    hasActedThisRound: ws.hasActedThisRound,
    canRaise: ws.canRaise,
    holeCards: hole ? [...hole] : [],
    revealedCards: ws.revealedCards ? [...ws.revealedCards] : undefined,
  };
}

function sidePotFromWire(p: WireSidePot): SidePot {
  return { amount: parseChip(p.amount), eligibleSeats: [...p.eligibleSeats] };
}

function resultFromWire(r: WireHandResult): HandResult {
  const potAwards: PotAward[] = r.potAwards.map((a) => ({
    potIndex: a.potIndex,
    amount: parseChip(a.amount),
    winners: [...a.winners],
  }));
  const payouts: Record<number, bigint> = {};
  for (const [seat, amt] of Object.entries(r.payouts)) {
    payouts[Number(seat)] = parseChip(amt);
  }
  return {
    endedBy: r.endedBy,
    potTotal: parseChip(r.potTotal),
    potAwards,
    payouts,
    refund: r.refund ? { seat: r.refund.seat, amount: parseChip(r.refund.amount) } : undefined,
  };
}

/**
 * Rebuild the authoritative bigint HandState from its persisted parts: the stored
 * public projection (`wire`) plus the secret `liveDeck` and `holes`. Parses every
 * chip field strictly and asserts structural invariants before returning (throws
 * on any inconsistency — so a serialize bug can never produce a usable bad state).
 */
export function deserializeAuthoritative(
  wire: WirePublicHandState,
  liveDeck: Card[],
  holes: SeatHole[],
): HandState {
  const version = wire.config.schemaVersion;
  if (version !== SCHEMA_VERSION && version !== BBA_STATE_SCHEMA_VERSION) {
    throw new Error('unsupported hand schema version');
  }
  if (version === BBA_STATE_SCHEMA_VERSION) {
    if (wire.config.bigBlindAnte === undefined || parseChip(wire.config.bigBlindAnte) <= 0n
      || !Number.isSafeInteger(wire.config.bigBlindAnteSeat)) {
      throw new Error('missing big-blind ante configuration');
    }
  } else if (wire.config.bigBlindAnte !== undefined || wire.config.bigBlindAnteSeat !== undefined
    || wire.seats.some(seat => seat.deadAnte !== undefined)) {
    throw new Error('big-blind ante requires its own hand schema');
  }
  const holesBySeat: Record<number, Card[]> = {};
  for (const h of holes) holesBySeat[h.seat] = h.cards;

  const state: HandState = {
    config: {
      handId: wire.config.handId,
      tableId: wire.config.tableId,
      handNo: wire.config.handNo,
      buttonSeat: wire.config.buttonSeat,
      sb: parseChip(wire.config.sb),
      bb: parseChip(wire.config.bb),
      ...(wire.config.bigBlindAnte !== undefined ? { bigBlindAnte: parseChip(wire.config.bigBlindAnte) } : {}),
      ...(wire.config.bigBlindAnteSeat !== undefined ? { bigBlindAnteSeat: wire.config.bigBlindAnteSeat } : {}),
      schemaVersion: wire.config.schemaVersion,
    },
    street: wire.street,
    board: [...wire.board],
    seats: wire.seats.map((ws) => seatFromWire(ws, holesBySeat)),
    buttonSeat: wire.buttonSeat,
    toAct: wire.toAct,
    currentBet: parseChip(wire.currentBet),
    lastFullRaiseSize: parseChip(wire.lastFullRaiseSize),
    aggressor: wire.aggressor,
    pot: parseChip(wire.pot),
    sidePots: wire.sidePots.map(sidePotFromWire),
    status: wire.status,
    result: wire.result ? resultFromWire(wire.result) : undefined,
    deck: [...liveDeck],
  };

  const violations = checkInvariants(state);
  if (violations.length > 0) {
    throw new Error(`deserializeAuthoritative: invariant violations: ${violations.join('; ')}`);
  }
  return state;
}
