// supabase/functions/_shared/pokerEngine/invariants.ts
//
// Runtime invariant checker for HandState — defense-in-depth for the server
// runtime and the replay/audit path. Pure and read-only: it never mutates the
// state it inspects. The engine's reducers are already property-tested; this
// module lets the PERSISTENCE layer (and replays of stored hands) cheaply
// verify that a state it loaded or produced is still self-consistent before
// trusting it.
//
// The one conservation invariant (locked): Σ(seat.stack) + pot === initialTotal.
// NEVER add `committed` — those chips are already inside `pot` (gross-pot rule).

import type { HandState } from './types.ts';
import { isCard } from './deck.ts';
import { computeSidePots } from './pots.ts';

/**
 * Check every structural invariant. Returns a list of human-readable
 * violations — empty means the state is consistent. Pass `initialTotal`
 * (Σ of all seats' starting stacks) to also check chip conservation.
 */
export function checkInvariants(state: HandState, initialTotal?: bigint): string[] {
  const v: string[] = [];
  const seats = state.seats;

  // ── per-seat chip sanity ──
  for (const s of seats) {
    const ante = s.deadAnte ?? 0n;
    if (ante < 0n || ante > (state.config.bigBlindAnte ?? 0n) || ante > s.totalCommitted - s.committed) {
      v.push(`seat ${s.seat}: invalid dead ante`);
    }
    if (s.stack < 0n) v.push(`seat ${s.seat}: negative stack ${s.stack}`);
    if (s.committed < 0n) v.push(`seat ${s.seat}: negative committed ${s.committed}`);
    if (s.totalCommitted < 0n) v.push(`seat ${s.seat}: negative totalCommitted ${s.totalCommitted}`);
    if (s.committed > s.totalCommitted) {
      v.push(`seat ${s.seat}: committed ${s.committed} > totalCommitted ${s.totalCommitted}`);
    }
    // Only during betting: at completion, refunds/payouts legitimately restore
    // chips to a seat whose status remains 'allin' (the engine does not flip it back).
    if (state.status === 'betting' && s.status === 'allin' && s.stack !== 0n) {
      v.push(`seat ${s.seat}: allin with non-zero stack ${s.stack} during betting`);
    }
    if (s.holeCards.length !== 0 && s.holeCards.length !== 2) {
      v.push(`seat ${s.seat}: holeCards length ${s.holeCards.length} (must be 0 or 2)`);
    }
    // once a hand is live, every seat still in it must hold exactly 2 cards —
    // this catches mis-deals (e.g. a blind-all-in seat skipped at the deal)
    // that chip conservation alone cannot see
    if (
      (state.status === 'betting' || state.status === 'complete') &&
      (s.status === 'active' || s.status === 'allin') &&
      s.holeCards.length !== 2
    ) {
      v.push(`seat ${s.seat}: in the hand with ${s.holeCards.length} hole cards (must be 2)`);
    }
  }
  if (seats.filter(seat => (seat.deadAnte ?? 0n) > 0n).length > 1) v.push('more than one big blind ante payer');

  // ── pot sanity + conservation ──
  if (state.pot < 0n) v.push(`negative pot ${state.pot}`);
  const sumStacks = seats.reduce((a, s) => a + s.stack, 0n);
  if (initialTotal !== undefined && sumStacks + state.pot !== initialTotal) {
    v.push(`chip conservation broken: stacks ${sumStacks} + pot ${state.pot} !== initial ${initialTotal}`);
  }

  // ── card integrity: no card appears twice across board/holeCards/deck ──
  const seen = new Map<string, string>();
  const claim = (card: string, where: string) => {
    if (!isCard(card)) v.push(`${where}: invalid card ${JSON.stringify(card)}`);
    const prior = seen.get(card);
    if (prior) v.push(`duplicate card ${card} in ${prior} and ${where}`);
    else seen.set(card, where);
  };
  state.board.forEach((c) => claim(c, 'board'));
  for (const s of seats) s.holeCards.forEach((c) => claim(c, `seat ${s.seat} holeCards`));
  state.deck.forEach((c) => claim(c, 'deck'));

  // ── turn pointer ──
  if (state.status === 'betting') {
    if (state.toAct === null) {
      v.push('betting status with no seat to act');
    } else {
      const actor = seats.find((s) => s.seat === state.toAct);
      if (!actor) v.push(`toAct points at unknown seat ${state.toAct}`);
      else if (actor.status !== 'active') v.push(`toAct seat ${state.toAct} is ${actor.status}, not active`);
    }
    // during betting no refunds have happened: every committed chip is in the gross pot
    const sumTotalCommitted = seats.reduce((a, s) => a + s.totalCommitted, 0n);
    if (sumTotalCommitted !== state.pot) {
      v.push(`Σ totalCommitted ${sumTotalCommitted} !== pot ${state.pot} during betting`);
    }
  }

  // ── side pots (live partition during betting) ──
  if (state.sidePots.length > 0) {
    let potSum = 0n;
    for (const [i, p] of state.sidePots.entries()) {
      potSum += p.amount;
      if (p.amount <= 0n) v.push(`side pot ${i}: non-positive amount ${p.amount}`);
      if (p.eligibleSeats.length === 0) v.push(`side pot ${i}: no eligible seats`);
      for (const sn of p.eligibleSeats) {
        const s = seats.find((x) => x.seat === sn);
        if (!s) v.push(`side pot ${i}: eligible seat ${sn} does not exist`);
        else if (s.status === 'folded') v.push(`side pot ${i}: folded seat ${sn} is eligible`);
      }
    }
    if (state.status === 'betting' && potSum !== state.pot) {
      v.push(`side pots sum ${potSum} !== pot ${state.pot}`);
    }
  }

  // ── completion / settlement ──
  if (state.status === 'complete') {
    if (state.toAct !== null) v.push(`complete hand with toAct=${state.toAct}`);
    if (state.pot !== 0n) v.push(`complete hand with undistributed pot ${state.pot}`);
    // both completion paths close street accounting; a live side-pot list would be stale too
    for (const s of seats) {
      if (s.committed !== 0n) v.push(`complete hand: seat ${s.seat} has stale committed ${s.committed}`);
    }
    if (state.sidePots.length !== 0) v.push(`complete hand with live sidePots (${state.sidePots.length})`);
    if (!state.result) {
      v.push('complete hand without a result');
    } else {
      const r = state.result;
      const paid = Object.values(r.payouts).reduce((a, x) => a + x, 0n);
      if (paid !== r.potTotal) v.push(`payouts ${paid} !== potTotal ${r.potTotal}`);

      // winners must be real, non-folded seats; payouts must go only to winners
      const winnerSet = new Set<number>();
      for (const a of r.potAwards) {
        if (a.winners.length === 0) v.push(`pot award ${a.potIndex}: no winners`);
        for (const w of a.winners) {
          winnerSet.add(w);
          const s = seats.find((x) => x.seat === w);
          if (!s) v.push(`pot award ${a.potIndex}: winner ${w} does not exist`);
          else if (s.status !== 'active' && s.status !== 'allin') {
            v.push(`pot award ${a.potIndex}: winner ${w} is ${s.status}`);
          }
        }
      }
      for (const [k, amt] of Object.entries(r.payouts)) {
        if (!winnerSet.has(Number(k))) v.push(`payout to non-winner seat ${k}`);
        if (amt <= 0n) v.push(`non-positive payout ${amt} to seat ${k}`);
      }

      // settlement cap: totalCommitted survives completion (only refundUncalled lowers
      // it), so the pot layers can be recomputed from the final state. No seat may be
      // paid more than the layers it was eligible for. (Holds for fold-to-one too: the
      // winner is the post-refund top committer, eligible for every layer.)
      const layers = computeSidePots(state);
      const capBySeat = new Map<number, bigint>();
      for (const p of layers) {
        for (const sn of p.eligibleSeats) capBySeat.set(sn, (capBySeat.get(sn) ?? 0n) + p.amount);
      }
      for (const [k, amt] of Object.entries(r.payouts)) {
        const cap = capBySeat.get(Number(k)) ?? 0n;
        if (amt > cap) v.push(`seat ${k} paid ${amt} > eligible cap ${cap}`);
      }

      // showdown awards must align 1:1 with the recomputed layers. (Fold-to-one
      // collapses everything into ONE award, so only the cap above applies there.)
      if (r.endedBy === 'showdown') {
        if (r.potAwards.length !== layers.length) {
          v.push(`showdown awards ${r.potAwards.length} !== recomputed layers ${layers.length}`);
        } else {
          for (const [i, a] of r.potAwards.entries()) {
            if (a.amount !== layers[i].amount) {
              v.push(`award ${i}: amount ${a.amount} !== recomputed layer ${layers[i].amount}`);
            }
            for (const w of a.winners) {
              if (!layers[i].eligibleSeats.includes(w)) {
                v.push(`award ${i}: winner ${w} not eligible for that layer`);
              }
            }
          }
        }
      }

      if (r.refund) {
        if (r.refund.amount <= 0n) v.push(`refund with non-positive amount ${r.refund.amount}`);
        if (!seats.some((s) => s.seat === r.refund!.seat)) {
          v.push(`refund to unknown seat ${r.refund.seat}`);
        }
      }
    }
  }

  return v;
}

/** Throw (with every violation listed) if the state is inconsistent. */
export function assertInvariants(state: HandState, initialTotal?: bigint): void {
  const v = checkInvariants(state, initialTotal);
  if (v.length > 0) {
    throw new Error(`HandState invariant violation(s):\n- ${v.join('\n- ')}`);
  }
}
