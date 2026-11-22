// supabase/functions/_shared/pokerEngine/pots.ts
// Side-pot construction, uncalled-bet refund, and clockwise odd-chip ordering.
// Pure; mutating helpers move chips pot<->stack so the invariant
//   Σ(seat.stack) + pot === initialTotal
// holds before AND after (refund: pot -> stack).

import type { HandState, SeatState, SidePot } from './types.ts';
import { seatsInClockwiseOrder } from './betting.ts';

const liveContribution = (seat: SeatState) => seat.totalCommitted - (seat.deadAnte ?? 0n);

/**
 * Build main + side pots from each seat's totalCommitted (across all streets).
 * Folded seats' chips stay in the pots (dead money) but folded seats are NEVER
 * eligible. Σ(side-pot amounts) === Σ(totalCommitted) === pot (after refund).
 */
export function computeSidePots(state: HandState): SidePot[] {
  const contributors = state.seats
    .map((s) => ({ seat: s.seat, amt: liveContribution(s), folded: s.status === 'folded' }))
    .filter((s) => s.amt > 0n);
  const ante = state.seats.reduce((total, seat) => total + (seat.deadAnte ?? 0n), 0n);

  const levels = [...new Set(contributors.map((c) => c.amt))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const pots: SidePot[] = [];
  let prev = 0n;
  for (const L of levels) {
    let count = 0;
    const eligible: number[] = [];
    for (const c of contributors) {
      if (c.amt >= L) {
        count++;
        if (!c.folded) eligible.push(c.seat);
      }
    }
    const amount = (L - prev) * BigInt(count);
    if (amount > 0n) pots.push({ amount, eligibleSeats: eligible });
    prev = L;
  }
  if (ante > 0n) {
    const eligibleSeats = state.seats
      .filter(seat => seat.status === 'active' || seat.status === 'allin')
      .map(seat => seat.seat);
    if (pots.length) {
      pots[0].amount += ante;
      pots[0].eligibleSeats = eligibleSeats;
    } else {
      pots.push({ amount: ante, eligibleSeats });
    }
  }
  return pots;
}

/**
 * Refund the uncalled top portion of the last bet to its owner. If exactly one
 * seat committed strictly more than everyone else, the excess was never matched
 * and is returned to that seat (pot -> stack). Returns the refunded amount.
 *
 * CONTRACT (locked): this is a SETTLEMENT-time operation — it runs at fold-to-one
 * and at showdown, BEFORE computeSidePots builds the awarded layers, so the
 * uncalled chips end up in the bettor's STACK and never inside an awarded pot.
 * Do NOT call it on an open `betting` state to preview an overhang: the lone-top
 * test would mis-flag the still-owed BIG BLIND as uncalled. (See
 * tests/pokerEngine/sidePotContract.test.ts for the locked behaviour.)
 */
export function refundUncalled(state: HandState): { seat: number; amount: bigint } | null {
  const inPlay = state.seats.filter((s) => liveContribution(s) > 0n);
  if (inPlay.length < 2) {
    // pathological: a single contributor — refund everything to them
    const only = inPlay[0];
    if (!only) return null;
    const amt = liveContribution(only);
    only.stack += amt;
    only.totalCommitted -= amt;
    state.pot -= amt;
    return { seat: only.seat, amount: amt };
  }
  const sorted = [...inPlay].sort((a, b) => (liveContribution(a) < liveContribution(b) ? 1 : liveContribution(a) > liveContribution(b) ? -1 : 0));
  const top = sorted[0];
  const second = liveContribution(sorted[1]);
  const topAmount = liveContribution(top);
  if (topAmount > second) {
    const excess = topAmount - second;
    top.stack += excess;
    top.totalCommitted -= excess;
    state.pot -= excess;
    return { seat: top.seat, amount: excess };
  }
  return null;
}

/**
 * Seat numbers in clockwise order starting at the seat AFTER the button.
 *
 * When the button sits on a seat that IS present (cash play, and tournaments
 * whose button is a live seat) the start is simply idx+1 — unchanged. When the
 * button sits on an EMPTY seat that is NOT in `seats` (a DEAD tournament button),
 * we anchor on the physical ring: start at the first present seat whose number is
 * strictly greater than `buttonSeat` (wrapping to the lowest seat when none is).
 * This keeps odd-chip distribution "first live seat clockwise from the button"
 * correct even when the button itself is empty.
 */
export function clockwiseSeatOrder(seats: SeatState[], buttonSeat: number): number[] {
  const ordered = seatsInClockwiseOrder(seats);
  const idx = ordered.findIndex((s) => s.seat === buttonSeat);
  let start: number;
  if (idx >= 0) {
    start = idx + 1; // button is a present seat — legacy behaviour, byte-identical
  } else {
    const after = ordered.findIndex((s) => s.seat > buttonSeat); // dead button: ring anchor
    start = after < 0 ? 0 : after;
  }
  const out: number[] = [];
  for (let k = 0; k < ordered.length; k++) out.push(ordered[(start + k) % ordered.length].seat);
  return out;
}

/**
 * Split `amount` among `winners`, giving any odd remainder chip-by-chip to the
 * winners nearest clockwise from the button (standard rule). Credits stacks and
 * reduces pot. Returns per-seat shares.
 */
export function distribute(
  state: HandState,
  amount: bigint,
  winners: number[],
  buttonSeat: number,
): Record<number, bigint> {
  // Defensive: both are unreachable from legal play today (the last aggressor at
  // the top commitment level can never have folded — there is no open-fold), but
  // a raw `amount / 0n` TypeError would be far harder to diagnose. If open-fold
  // is ever allowed, an all-folded pot layer becomes a real rules question.
  if (winners.length === 0) throw new Error('distribute: no winners for pot');
  if (new Set(winners).size !== winners.length) throw new Error('distribute: duplicate winners');
  const shares: Record<number, bigint> = {};
  const k = BigInt(winners.length);
  const base = amount / k;
  let rem = amount % k;
  const order = clockwiseSeatOrder(state.seats, buttonSeat).filter((sn) => winners.includes(sn));
  for (const seatNo of order) {
    let share = base;
    if (rem > 0n) { share += 1n; rem -= 1n; }
    const s = state.seats.find((x) => x.seat === seatNo)!;
    s.stack += share;
    state.pot -= share;
    shares[seatNo] = (shares[seatNo] ?? 0n) + share;
  }
  return shares;
}
