// supabase/functions/_shared/pokerEngine/events.ts
// PUBLIC event builders. The engine emits events WITHOUT a `seq` — the durable
// per-hand sequence number is assigned by the persistence layer (single owner),
// so engine output and storage never double-stamp seq.
//
// HARD RULE: an event payload must NEVER contain a hidden hole card or an
// unrevealed board card. `board_revealed` carries only the just-opened cards;
// `showdown` carries only the revealed cards of CONTESTING seats.

import type { Card, HandEvent, HandEventType, PotAward } from './types.ts';

export function ev(type: HandEventType, payload: Record<string, unknown> = {}): HandEvent {
  return { type, payload };
}

export const handStarted = (handId: string, buttonSeat: number, seats: number[]): HandEvent =>
  ev('hand_started', { handId, buttonSeat, seats });

// `sbSeat` is null + `sb` is "0" for a DEAD small blind (tournament dead-button
// hand where the SB position is an empty seat — only the BB is posted).
export const blindsPosted = (sbSeat: number | null, bbSeat: number, sb: string, bb: string, ante?: string): HandEvent =>
  ev('blinds_posted', { sbSeat, bbSeat, sb, bb, ...(ante === undefined ? {} : { ante }) });

/** Announces dealing only — carries NO cards (cards are private). */
export const holeCardsDealt = (seats: number[]): HandEvent =>
  ev('hole_cards_dealt', { seats });

export const actionEvent = (
  seat: number,
  actionType: string,
  amount: bigint,
  pot: bigint,
): HandEvent => ev('action', { seat, actionType, amount: amount.toString(), pot: pot.toString() });

export const streetAdvanced = (street: string): HandEvent => ev('street_advanced', { street });

/** Carries ONLY the cards just turned over for this street. */
export const boardRevealed = (street: string, cards: Card[]): HandEvent =>
  ev('board_revealed', { street, cards });

/** The unmatched top of the last bet returned to its owner (pot -> stack), before any award. */
export const uncalledReturned = (seat: number, amount: bigint): HandEvent =>
  ev('uncalled_returned', { seat, amount: amount.toString() });

export const potAwarded = (awards: PotAward[]): HandEvent =>
  ev('pot_awarded', {
    awards: awards.map((a) => ({
      potIndex: a.potIndex,
      amount: a.amount.toString(),
      winners: a.winners,
    })),
  });

/** Carries ONLY the revealed cards of contesting seats. */
export const showdownEvent = (reveals: { seat: number; cards: Card[] }[]): HandEvent =>
  ev('showdown', { reveals });

export const handComplete = (endedBy: string, potTotal: bigint): HandEvent =>
  ev('hand_complete', { endedBy, potTotal: potTotal.toString() });
