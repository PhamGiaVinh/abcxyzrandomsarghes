// Canonical, PURE hand-flow engine for Tracker Engine Mode (Phase 1).
//
// No React, no Supabase, no side effects — it derives action order, legal
// actions, betting-round closure, street progression, fold-win / simple
// selected-winner settlement, and the "bet to" → "chips added" conversion from a
// normalized snapshot of the operator's existing local hand state.
//
// Scope (Phase 1): single-winner + simple even-split settlement only. It is NOT
// a full side-pot settlement engine and does NOT rank hands — multiway all-in
// side-pot attribution and showdown auto-rank are deferred to Phase 2. Chip
// conservation (Σ ending === Σ starting) is enforced but is not, by itself, a
// proof of side-pot correctness.
//
// Seat numbering is assumed clockwise-ascending (same convention as
// lib/tournament/button.ts and handFlow.ts). It owns button/dead-blind
// presentation only; canonical wager legality comes from handStateCore.

import {
  actorViewFromRuntime,
  reduceHandAtStreet,
  type ActionRow,
  type PlayerSeed,
} from "./handStateCore";

export type Street = "preflop" | "flop" | "turn" | "river" | "showdown";
export const STREETS: Street[] = ["preflop", "flop", "turn", "river", "showdown"];

/** A dealt-in seat with its current money state for the hand in progress. */
export interface EngineSeat {
  player_id: string;
  seat_number: number;
  starting_stack: number;
  /** Chips remaining in front of the player. */
  stack: number;
  /** Chips committed on the CURRENT street (resets each street). */
  street_committed: number;
  /** Chips committed across the whole hand (drives the pot + settlement). */
  total_committed: number;
  folded: boolean;
  all_in: boolean;
}

/** Minimal shape of a this-street action used to compute order/closure. */
export interface EngineStreetAction {
  player_id: string;
  seat_number: number;
  action_type: string; // fold/check/call/bet/raise/all_in/post_sb/post_bb/post_ante
}

export interface EngineState {
  seats: EngineSeat[];
  buttonSeat: number;
  street: Street;
  /** This street's actions, in order, INCLUDING blind/ante posts. */
  streetActions: EngineStreetAction[];
  /** Full action stream lets the action panel reuse the shared legal-action core. */
  canonicalActions?: readonly ActionRow[];
  /** Big blind size (min-raise guidance). 0 → fall back to current bet. */
  bigBlind?: number;
  /**
   * P2-3 dead small blind: this hand posts no SB (the SB position is dead after a
   * bust, per the tournament dead-button rule). OPTIONAL — only the engine
   * standalone console sets it; default false ⇒ the normal flow and the old
   * embedded tab are unchanged. When true, the SB is neither prompted nor required.
   */
  deadSb?: boolean;
  /**
   * P2-5 dead-button: the BB seat per the tournament forward-moving button rule,
   * which can differ from `blindSeats(occupied, button)` when the button/SB sit on
   * empty seats. OPTIONAL — when set it drives the BB post-prompt, the preflop
   * first-actor seed, and the BB-owed check (so the actor order is correct under a
   * dead button) WITHOUT touching `blindSeats`. The SB-owed check stays global
   * (`sbPosted`) and `deadSb` covers a dead SB, so the SB needs no override. Default
   * unset ⇒ `blindSeats` drives everything (normal flow + old tab unchanged).
   */
  bbSeatOverride?: number;
  /**
   * Cover-call runout waiver (trackerCoverCallRunout, UAT wave 2): when the hand is
   * an all-in runout with exactly ONE eligible (non-folded, non-all-in) player left
   * and that player owes no call, betting for the hand is CLOSED — the lone coverer
   * is not asked to "check" every remaining street, and `actorToAct` returns null so
   * the board can run out. OPTIONAL — the hook sets it from the feature flag; default
   * unset ⇒ behavior byte-identical to today (engine stays pure, no flag import).
   */
  coverCallWaiver?: boolean;
}

export interface LegalActions {
  fold: boolean;
  check: boolean;
  call: boolean;
  bet: boolean;
  raise: boolean;
  allIn: boolean;
}

export interface ActorView {
  player_id: string;
  seat_number: number;
  /** When set, this player still owes a blind/ante post before voluntary action. */
  needsPost?: "post_sb" | "post_bb";
  toCall: number;
  minRaiseTo: number;
  legal: LegalActions;
}

const POST_TYPES = new Set(["post_sb", "post_bb", "post_ante"]);
const AGGRESSIVE = new Set(["bet", "raise", "all_in", "post_bb"]); // post_bb opens preflop

// ---------- seat-ring helpers (clockwise = ascending seat_number) ----------

function sortedSeatNumbers(seats: EngineSeat[]): number[] {
  return [...new Set(seats.map((s) => s.seat_number))].sort((a, b) => a - b);
}

/** Occupied seats clockwise, starting at the first seat AFTER `afterSeat`. */
export function ringAfter(seatNums: number[], afterSeat: number): number[] {
  const ring = [...seatNums].sort((a, b) => a - b);
  if (ring.length === 0) return [];
  const idx = ring.findIndex((s) => s > afterSeat);
  const start = idx === -1 ? 0 : idx;
  return [...ring.slice(start), ...ring.slice(0, start)];
}

/** SB / BB seats derived purely from the button (heads-up: button = SB). */
export function blindSeats(
  seatNums: number[],
  buttonSeat: number
): { sbSeat: number | null; bbSeat: number | null } {
  const ring = [...seatNums].sort((a, b) => a - b);
  const n = ring.length;
  if (n < 2) return { sbSeat: null, bbSeat: null };
  // Order clockwise starting at the button (or next occupied seat if the button
  // sits on an empty seat).
  let start = ring.indexOf(buttonSeat);
  if (start < 0) {
    const higher = ring.findIndex((s) => s > buttonSeat);
    start = higher < 0 ? 0 : higher;
  }
  const order = [...ring.slice(start), ...ring.slice(0, start)];
  if (n === 2) return { sbSeat: order[0], bbSeat: order[1] }; // heads-up: button = SB
  return { sbSeat: order[1], bbSeat: order[2] };
}

/**
 * First voluntary preflop actor = the first ACTIVE seat clockwise-left of the BB
 * (only dealt-in seats are passed, so empty seats are naturally skipped).
 * Heads-up → the button/SB. Returns null for < 2 seats. (Display/UTG helper for
 * the blind-setup panel; the full owing-aware actor stays `actorToAct`.)
 */
export function firstPreflopActor(activeSeatNums: number[], buttonSeat: number): number | null {
  const seats = [...new Set(activeSeatNums)]
    .filter((s) => Number.isInteger(s) && s > 0)
    .sort((a, b) => a - b);
  if (seats.length === 0) return null;
  if (seats.length === 1) return seats[0];
  const { bbSeat } = blindSeats(seats, buttonSeat);
  if (bbSeat == null) return null;
  return ringAfter(seats, bbSeat)[0] ?? null;
}

/**
 * First POSTFLOP actor = the first ACTIVE seat clockwise-left of the BUTTON
 * (empty seats skipped). Heads-up → the BB/non-button (the seat after the
 * button). Returns null for < 2 seats.
 */
export function firstPostflopActor(activeSeatNums: number[], buttonSeat: number): number | null {
  const seats = [...new Set(activeSeatNums)]
    .filter((s) => Number.isInteger(s) && s > 0)
    .sort((a, b) => a - b);
  if (seats.length === 0) return null;
  if (seats.length === 1) return seats[0];
  return ringAfter(seats, buttonSeat)[0] ?? null;
}

/**
 * Showdown reveal order (trackerShowdownRevealOrder): the sequence in which the
 * SHOWING players table their cards, per standard poker/TDA procedure —
 *   • if there was a bet/raise/all-in on the FINAL betting street, that last
 *     aggressor tables FIRST (`finalAggressorSeat`), then clockwise;
 *   • otherwise (checked to showdown, or all-in from an earlier street), the
 *     first active seat clockwise-left of the BUTTON tables first (= SB / "from
 *     the SB", via `firstPostflopActor` — showdown order is button-relative, not
 *     BB-relative, even for a preflop all-in), then clockwise.
 * `shownSeatNumbers` = only the seats that WILL show (non-folded, non-mucked,
 * hole cards revealed). Pure + presentational: order-only, no money/legality.
 * ≤1 shown seat → returned as-is.
 */
export function showdownRevealOrder(args: {
  shownSeatNumbers: number[];
  buttonSeat: number;
  finalAggressorSeat?: number | null;
}): number[] {
  const shown = [...new Set(args.shownSeatNumbers)]
    .filter((s) => Number.isInteger(s) && s > 0)
    .sort((a, b) => a - b);
  if (shown.length <= 1) return shown;
  const agg = args.finalAggressorSeat;
  const start =
    agg != null && shown.includes(agg)
      ? agg
      : firstPostflopActor(shown, args.buttonSeat) ?? shown[0];
  // Rotate the sorted ring so `start` is first, then clockwise. (Not
  // `[start, ...ringAfter]` — ringAfter already wraps back around to include start.)
  const si = shown.indexOf(start);
  return [...shown.slice(si), ...shown.slice(0, si)];
}

// ---------- money / street state ----------

export function currentBet(seats: EngineSeat[]): number {
  return seats.reduce((m, s) => (!s.folded && s.street_committed > m ? s.street_committed : m), 0);
}

/** Players who took a VOLUNTARY (non-post) action on this street. */
function actedThisStreet(streetActions: EngineStreetAction[]): Set<string> {
  return new Set(streetActions.filter((a) => !POST_TYPES.has(a.action_type)).map((a) => a.player_id));
}

function seatOf(seats: EngineSeat[], seatNumber: number): EngineSeat | undefined {
  return seats.find((s) => s.seat_number === seatNumber);
}

function eligible(s: EngineSeat | undefined): boolean {
  return !!s && !s.folded && !s.all_in && s.stack > 0;
}

/** A live player still owes action on this street (must match the bet or act). */
function owes(s: EngineSeat, highest: number, acted: Set<string>): boolean {
  if (s.folded || s.all_in) return false;
  return s.street_committed < highest || !acted.has(s.player_id);
}

/**
 * Cover-call runout waiver (trackerCoverCallRunout): the LONE eligible seat owes
 * nothing — it has matched the highest bet — so betting for the HAND is closed and
 * no voluntary action ("pointless check") is required on this or later streets.
 * Guards, in order: flag off → never; <2 live players → fold-win path owns it;
 * ≠1 eligible → either already closed (0) or normal betting (2+); the lone eligible
 * seat still owing a call (mid-street uncalled all-in) → NOT waived.
 */
function loneActorWaived(state: EngineState): boolean {
  if (!state.coverCallWaiver) return false;
  const live = state.seats.filter((s) => !s.folded);
  if (live.length < 2) return false;
  const elig = state.seats.filter((s) => eligible(s));
  if (elig.length !== 1) return false;
  return elig[0].street_committed >= currentBet(state.seats);
}

// ---------- actor order ----------

/**
 * The player whose turn it is, with a `needsPost` hint while blinds are still
 * being posted preflop. Returns null when the betting round is complete.
 *
 * Preflop: SB posts, then BB posts, then voluntary action starts at the first
 * eligible seat LEFT OF THE BB (heads-up that is the button/SB → correct
 * heads-up "button acts first preflop"). Postflop: first eligible seat left of
 * the button (heads-up → BB/non-button acts first).
 */
export function actorToAct(state: EngineState): ActorView | null {
  const { seats, buttonSeat, street, streetActions } = state;
  const seatNums = sortedSeatNumbers(seats);
  const acted = actedThisStreet(streetActions);
  const highest = currentBet(seats);

  // Preflop blind-posting phase (order: SB before BB) — drives correct heads-up.
  if (street === "preflop") {
    const { sbSeat, bbSeat } = blindSeats(seatNums, buttonSeat);
    // P2-5: the dead-button BB overrides blindSeats' pick when set.
    const effBbSeat = state.bbSeatOverride ?? bbSeat;
    const sbPosted = streetActions.some((a) => a.action_type === "post_sb");
    const bbPosted = streetActions.some((a) => a.action_type === "post_bb");
    if (!state.deadSb && sbSeat != null && !sbPosted) {
      const p = seatOf(seats, sbSeat);
      if (p && !p.folded) return view(state, p, "post_sb");
    }
    if (effBbSeat != null && !bbPosted) {
      const p = seatOf(seats, effBbSeat);
      if (p && !p.folded) return view(state, p, "post_bb");
    }
  }

  // Cover-call runout waiver — AFTER the blind-post prompts (posting is never
  // skipped), BEFORE the voluntary-action sweep: nobody acts in a runout.
  if (loneActorWaived(state)) return null;

  // Seed: preflop → after BB; postflop → after button. If someone already acted
  // voluntarily, continue clockwise from the last actor instead.
  const lastVoluntary = [...streetActions].reverse().find((a) => !POST_TYPES.has(a.action_type));
  let seed: number;
  if (lastVoluntary) {
    seed = lastVoluntary.seat_number;
  } else if (street === "preflop") {
    const { bbSeat } = blindSeats(seatNums, buttonSeat);
    seed = state.bbSeatOverride ?? bbSeat ?? buttonSeat; // P2-5 dead-button BB anchors the first actor
  } else {
    seed = buttonSeat;
  }

  for (const seatNumber of ringAfter(seatNums, seed)) {
    const p = seatOf(seats, seatNumber);
    if (p && owes(p, highest, acted) && eligible(p)) return view(state, p, undefined);
  }
  return null;
}

/** Betting round is complete when no eligible player still owes action. */
export function isRoundComplete(state: EngineState): boolean {
  // While a blind still owes its post, the round is not complete.
  if (state.street === "preflop") {
    const seatNums = sortedSeatNumbers(state.seats);
    const { sbSeat, bbSeat } = blindSeats(seatNums, state.buttonSeat);
    const sbPosted = state.streetActions.some((a) => a.action_type === "post_sb");
    const bbPosted = state.streetActions.some((a) => a.action_type === "post_bb");
    const effBbSeat = state.bbSeatOverride ?? bbSeat; // P2-5 dead-button BB
    const sb = sbSeat != null ? seatOf(state.seats, sbSeat) : undefined;
    const bb = effBbSeat != null ? seatOf(state.seats, effBbSeat) : undefined;
    // A DEAD SB is suppressed by the `deadSb` FLAG (P2-3), NOT by blindSeats
    // returning null — blindSeats is untouched and still returns the occupied SB
    // seat; the flag is what skips the SB-owed requirement. The `sbPosted` test is
    // GLOBAL (any post_sb), so even when the dead-button SB ≠ blindSeats' pick the
    // check passes once the operator posts the real SB (P2-5 sufficiency).
    if (!state.deadSb && sb && !sb.folded && !sbPosted) return false;
    if (bb && !bb.folded && !bbPosted) return false;
  }
  // Cover-call runout waiver — AFTER the preflop post guard (blinds always post
  // first): the lone coverer who matched the bet owes nothing more this hand.
  if (loneActorWaived(state)) return true;
  const highest = currentBet(state.seats);
  const acted = actedThisStreet(state.streetActions);
  return !state.seats.some((s) => owes(s, highest, acted));
}

function view(state: EngineState, p: EngineSeat, needsPost: "post_sb" | "post_bb" | undefined): ActorView {
  if (state.canonicalActions) {
    const seeds: PlayerSeed[] = state.seats.map((seat) => ({
      player_id: seat.player_id,
      seat_number: seat.seat_number,
      starting_stack: seat.starting_stack,
    }));
    const canonical = actorViewFromRuntime(
      reduceHandAtStreet(seeds, [...state.canonicalActions], state.buttonSeat, state.street),
      p.player_id,
    );
    return { player_id: p.player_id, seat_number: p.seat_number, needsPost, ...canonical };
  }
  const highest = currentBet(state.seats);
  const toCall = Math.min(Math.max(0, highest - p.street_committed), p.stack);
  const bb = state.bigBlind && state.bigBlind > 0 ? state.bigBlind : 0;
  const minRaiseIncrement = bb > 0 ? bb : highest > 0 ? highest : 1;
  const minRaiseTo = highest + minRaiseIncrement;
  return {
    player_id: p.player_id,
    seat_number: p.seat_number,
    needsPost,
    toCall,
    minRaiseTo,
    legal: {
      fold: true,
      check: toCall === 0,
      call: toCall > 0,
      bet: highest === 0,
      raise: highest > 0 && p.stack > toCall,
      allIn: p.stack > 0,
    },
  };
}

// ---------- bet sizing: "Bet to" (street total) → chips added ----------

/**
 * Convert the keypad's "Bet to" (street total) into chips ADDED this action.
 * All-in only when the added chips consume the whole remaining stack — a "bet
 * to 8" with a larger stack is NEVER all-in.
 */
export function betToAdded(
  betTo: number,
  streetCommitted: number,
  stack: number
): { added: number; allIn: boolean } {
  const want = Math.max(0, Math.floor(betTo) - streetCommitted);
  const added = Math.min(want, stack);
  return { added, allIn: added >= stack && added > 0 };
}

// ---------- hand completion ----------

/** Exactly one non-folded player ⇒ the hand is over and they win the pot. */
export function foldWinner(seats: EngineSeat[]): EngineSeat | null {
  const live = seats.filter((s) => !s.folded);
  return live.length === 1 ? live[0] : null;
}

export interface SettleResult {
  player_id: string;
  ending_stack: number;
}

function potOf(seats: EngineSeat[]): number {
  return seats.reduce((sum, s) => sum + Math.max(0, s.total_committed), 0);
}

/** Fold-win settlement: the lone remaining player collects the whole pot. */
export function settleFoldWin(seats: EngineSeat[]): SettleResult[] {
  const winner = foldWinner(seats);
  const pot = potOf(seats);
  return seats.map((s) => ({
    player_id: s.player_id,
    ending_stack: s.stack + (winner && s.player_id === winner.player_id ? pot : 0),
  }));
}

/**
 * Simple selected-winner settlement (operator picks the winner[s] at showdown).
 * Splits the WHOLE pot evenly between the selected winners; the odd remainder
 * chip goes to the earliest seat. Phase-1 fallback only — NOT side-pot exact.
 */
export function settleSelectedWinners(seats: EngineSeat[], winnerIds: string[]): SettleResult[] {
  const winners = seats.filter((s) => winnerIds.includes(s.player_id));
  const pot = potOf(seats);
  if (winners.length === 0) {
    // No winner chosen → no redistribution (operator still in Review).
    return seats.map((s) => ({ player_id: s.player_id, ending_stack: s.stack }));
  }
  const share = Math.floor(pot / winners.length);
  let remainder = pot - share * winners.length;
  // Earliest seat first for deterministic odd-chip assignment.
  const orderedWinnerIds = [...winners]
    .sort((a, b) => a.seat_number - b.seat_number)
    .map((s) => s.player_id);
  const extra = new Map<string, number>();
  for (const id of orderedWinnerIds) {
    extra.set(id, share + (remainder > 0 ? 1 : 0));
    if (remainder > 0) remainder -= 1;
  }
  return seats.map((s) => ({
    player_id: s.player_id,
    ending_stack: s.stack + (extra.get(s.player_id) ?? 0),
  }));
}

/** Chip conservation invariant: total chips are unchanged across the hand. */
export function assertChipConservation(seats: EngineSeat[], settled: SettleResult[]): boolean {
  const startTotal = seats.reduce((s, p) => s + p.starting_stack, 0);
  const endTotal = settled.reduce((s, r) => s + r.ending_stack, 0);
  return startTotal === endTotal;
}

// ---------- street progression ----------

export function nextStreetAfter(street: Street): Street | null {
  const i = STREETS.indexOf(street);
  return i >= 0 && i < STREETS.length - 1 ? STREETS[i + 1] : null;
}

/** Players who can still make a betting decision on a future street. */
export function eligibleActorCount(seats: EngineSeat[]): number {
  return seats.filter((s) => eligible(s)).length;
}

/**
 * Whether the hand should fast-forward (no further betting possible): ≤1 player
 * can still act, so remaining streets just run the board out to showdown.
 */
export function isRunout(seats: EngineSeat[]): boolean {
  const live = seats.filter((s) => !s.folded);
  return live.length >= 2 && eligibleActorCount(seats) <= 1;
}

// ---------- blind level context (Floor clock snapshot) ----------

/** A blind level snapshotted at hand start (from get_tournament_clock.current_level). */
export interface BlindLevelSnapshot {
  level_number: number | null;
  small_blind: number;
  big_blind: number;
  ante: number;
  big_blind_ante_only?: boolean;
  small_blind_seat?: number | null;
  big_blind_seat?: number;
}

/** Loose shape of get_tournament_clock's `current_level` (fields optional). */
export interface ClockLevel {
  level_number?: number | null;
  small_blind?: number | null;
  big_blind?: number | null;
  ante?: number | null;
}

const lvl0 = (n: number | null | undefined) => Math.max(0, Math.floor(Number(n) || 0));

/** Snapshot the Floor blind level for THIS hand. Snapshot once at hand start;
 *  never mutate it mid-hand (live poker keeps a hand on the level it started). */
export function snapshotBlindLevel(currentLevel: ClockLevel | null | undefined): BlindLevelSnapshot {
  return {
    level_number: currentLevel?.level_number ?? null,
    small_blind: lvl0(currentLevel?.small_blind),
    big_blind: lvl0(currentLevel?.big_blind),
    ante: lvl0(currentLevel?.ante),
  };
}

/** True when the Floor clock advanced to a DIFFERENT level after the hand started.
 *  The current hand keeps its snapshot; the banner just informs the operator. */
export function hasLevelChangedDuringHand(
  snapshot: BlindLevelSnapshot | null | undefined,
  currentLevel: ClockLevel | null | undefined
): boolean {
  if (!snapshot || snapshot.level_number == null) return false;
  const now = currentLevel?.level_number ?? null;
  return now != null && now !== snapshot.level_number;
}
