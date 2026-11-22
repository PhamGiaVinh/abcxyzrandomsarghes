// supabase/functions/_shared/pokerEngine/views.ts
// Public/private state projection + transport serialization.
//
// SECRECY BOUNDARY: toPublicView strips the deck and every seat's holeCards, so
// no public view/event can leak a hidden card (revealedCards — set only at
// showdown for contesting seats — IS public). toPrivateView adds back ONLY the
// requesting seat's own hole cards.
//
// TRANSPORT: serializeForTransport renders every bigint as a DECIMAL STRING, so
// chips survive JSON without precision loss and downstream code never sees a
// lossy JS number.

import type { Card, HandConfig, HandResult, SeatStatus, SidePot, Street, HandState } from './types.ts';

export interface PublicSeat {
  seat: number;
  playerId: string;
  startingStack: bigint;
  stack: bigint;
  committed: bigint;
  totalCommitted: bigint;
  deadAnte?: bigint;
  status: SeatStatus;
  hasActedThisRound: boolean;
  canRaise: boolean;
  revealedCards?: Card[]; // public (showdown) only
}

export interface PublicHandState {
  config: HandConfig;
  street: Street;
  board: Card[];
  seats: PublicSeat[];
  buttonSeat: number;
  toAct: number | null;
  currentBet: bigint;
  lastFullRaiseSize: bigint;
  aggressor: number | null;
  pot: bigint;
  sidePots: SidePot[];
  status: HandState['status'];
  result?: HandResult;
}

export interface PrivateHandState extends PublicHandState {
  mySeat: number;
  myHoleCards: Card[];
}

export function toPublicView(state: HandState): PublicHandState {
  return {
    config: { ...state.config },
    street: state.street,
    board: [...state.board],
    seats: state.seats.map((s) => ({
      seat: s.seat,
      playerId: s.playerId,
      startingStack: s.startingStack,
      stack: s.stack,
      committed: s.committed,
      totalCommitted: s.totalCommitted,
      ...(s.deadAnte !== undefined ? { deadAnte: s.deadAnte } : {}),
      status: s.status,
      hasActedThisRound: s.hasActedThisRound,
      canRaise: s.canRaise,
      revealedCards: s.revealedCards ? [...s.revealedCards] : undefined,
      // NOTE: holeCards deliberately omitted.
    })),
    buttonSeat: state.buttonSeat,
    toAct: state.toAct,
    currentBet: state.currentBet,
    lastFullRaiseSize: state.lastFullRaiseSize,
    aggressor: state.aggressor,
    pot: state.pot,
    sidePots: state.sidePots.map((p: SidePot) => ({ amount: p.amount, eligibleSeats: [...p.eligibleSeats] })),
    status: state.status,
    result: state.result
      ? {
          ...state.result,
          potAwards: state.result.potAwards.map((a) => ({ ...a, winners: [...a.winners] })),
          payouts: { ...state.result.payouts },
        }
      : undefined,
  };
}

export function toPrivateView(state: HandState, seat: number): PrivateHandState {
  const s = state.seats.find((x) => x.seat === seat);
  return { ...toPublicView(state), mySeat: seat, myHoleCards: s ? [...s.holeCards] : [] };
}

/** JSON with every bigint emitted as a decimal string (chip-safe transport). */
export function serializeForTransport(obj: unknown): string {
  return JSON.stringify(obj, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
}
