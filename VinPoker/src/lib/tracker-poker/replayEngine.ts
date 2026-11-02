// Tracker hand REPLAY engine — pure reducer that turns a completed hand
// (hand_players seeds + the hand_actions stream + final community cards) into an
// immutable array of frames, one per action index. Frame k = the table state
// AFTER applying actions[0..k-1], shaped to drive the existing <LiveFelt> with
// no felt changes. No React, no Supabase, no side effects → unit-testable.
//
// Action-amount convention matches T3A/T4: action_amount = chips ADDED this
// street (never a raise-to total), so running pot = Σ contributing amounts.

import { getHandSeatPositions } from "@/lib/tournament/button";
import {
  computePotBreakdown,
  contributionsFromActions,
  streetContribution,
  type PotBreakdown,
} from "@/lib/tracker-poker/potEngine";
import {
  formatActionLabel,
  type SeatInfo,
  type ActionLog,
} from "@/components/cashier/tournament-live/LiveFelt";
import { settleShowdown } from "./trackerShowdown";
import type { ReplayPublicSettlement } from "./replaySettlement";
import { resolveViewerHandBigBlind } from "./viewerAmounts";

export interface ReplayHandPlayer {
  player_id: string;
  seat_number: number;
  display_name: string;
  starting_stack: number;
  /** Stack after the hand settled — completed hands only; enables net-win display. */
  ending_stack?: number | null;
  avatar_url?: string | null;
  hole_cards?: string[];
}

export interface ReplayHandAction {
  action_id?: string;
  player_id: string;
  street: string;
  action_type: string;
  action_amount: number;
  action_order: number;
}

export interface ReplayHand {
  hand_id?: string;
  hand_number: number;
  button_seat: number;
  community_cards: string[];
  /** Persisted display fallback, used only when the action stream is absent. */
  stored_pot_size?: number | null;
  /** Big blind for BB display (0/undefined → no BB shown). */
  big_blind?: number;
  small_blind?: number | null;
  ante?: number | null;
  level_number?: number | null;
  players: ReplayHandPlayer[];
  actions: ReplayHandAction[];
  /** Fresh, public-safe settlement returned by get_public_tournament_settlement. */
  publicSettlement?: ReplayPublicSettlement | null;
  /** Read-only verified result from the exact hand in public table History. */
  publicHistoryResult?: {
    status: "verified";
    recipients: Array<{
      playerId: string;
      seatNumber: number | null;
      name: string;
      potAward: number;
      netDelta: number;
      potKinds: Array<"main" | "side">;
    }>;
  } | null;
}

export interface ReplayFrame {
  /** 0..N — number of actions applied. */
  index: number;
  seats: SeatInfo[];
  /** Community cards padded to 5 ("" = empty). */
  displayCards: string[];
  /** Running pot; final frame uses the post-refund distributable pot. */
  potSize: number;
  potBreakdown: PotBreakdown | null;
  currentStreet: string;
  /** Actor of the last applied action (felt highlights if not folded). */
  lastActorId: string | null;
  latestAction: ActionLog | null;
  /** True only on the final frame once hole cards were revealed at showdown. */
  revealHoleCards: boolean;
  /** Display-only showdown state; never writes or replaces recorded stacks. */
  showdownResult?: "winner" | "chop" | "needs_resettle" | null;
  /** Display-only winner ids, present only when the recorded payout matches the pure settlement. */
  showdownWinnerIds?: string[];
  /** Server-verified pot allocations. Legacy client reconstruction never populates this. */
  potAwards?: { potIndex: number; amount: number; winnerPlayerIds: string[] }[];
  /** True only for a revision/hash-matched public settlement supplied by the server. */
  payoutVerified?: boolean;
}

const STREETS = ["preflop", "flop", "turn", "river", "showdown"];
const CONTRIBUTING = new Set([
  "bet",
  "raise",
  "call",
  "all_in",
  "post_sb",
  "post_bb",
  "post_ante",
]);

function streetIndexOf(s: string): number {
  const i = STREETS.indexOf(s);
  return i < 0 ? 0 : i;
}

/** Cards visible at a given street index: preflop 0, flop 3, turn 4, river/showdown 5. */
function boardCount(streetIndex: number): number {
  if (streetIndex >= 3) return 5; // river + showdown
  if (streetIndex === 2) return 4; // turn
  if (streetIndex === 1) return 3; // flop
  return 0; // preflop
}

function clampChips(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : 0;
  return v > 0 ? v : 0;
}

function deriveShowdownResult(
  players: ReplayHandPlayer[],
  runtime: Map<string, SeatRuntime>,
  actions: ReplayHandAction[],
  board: string[],
): {
  result: "winner" | "chop" | "needs_resettle";
  winnerIds: string[];
  payoutMatches: boolean;
  potAwards: { potIndex: number; amount: number; winnerPlayerIds: string[] }[];
  payoutAwards: Record<string, number>;
  refundAwards: Record<string, number>;
} | null {
  if (board.length !== 5) return null;

  const contributors = new Map(
    contributionsFromActions(actions as any).map((p) => [p.player_id, p.total_bet]),
  );
  const seats = players.map((p) => {
    const state = runtime.get(p.player_id)!;
    return {
      player_id: p.player_id,
      seat_number: p.seat_number,
      starting_stack: clampChips(p.starting_stack),
      stack: state.chip,
      street_committed: 0,
      total_committed: contributors.get(p.player_id) ?? 0,
      folded: state.folded,
      all_in: state.allIn,
    };
  });
  const holes = Object.fromEntries(
    players
      .filter((p) => p.hole_cards?.length === 2)
      .map((p) => [p.player_id, p.hole_cards!]),
  );
  const settlement = settleShowdown(seats, holes, board);
  if (!settlement) return null;

  const winnerIds = [...new Set(settlement.layers.flatMap((layer) => layer.winner_player_ids))];
  if (winnerIds.length === 0) return null;
  const payoutMatches = players.every((p) => {
    if (p.ending_stack == null) return false;
    return settlement.results.find((r) => r.player_id === p.player_id)?.ending_stack === p.ending_stack;
  });
  const allLayersAreTied = settlement.layers.every((layer) => layer.winner_player_ids.length > 1);
  const refundAwards = settlement.uncalled
    ? { [settlement.uncalled.player_id]: settlement.uncalled.amount }
    : {};
  const payoutAwards = Object.fromEntries(
    settlement.results.map((result) => [
      result.player_id,
      Math.max(
        0,
        result.ending_stack
          - (runtime.get(result.player_id)?.chip ?? 0)
          - (refundAwards[result.player_id] ?? 0),
      ),
    ]),
  );
  return {
    result: !payoutMatches ? "needs_resettle" : allLayersAreTied ? "chop" : "winner",
    winnerIds: payoutMatches ? winnerIds : [],
    payoutMatches,
    potAwards: payoutMatches
      ? settlement.layers.map((layer) => ({
          potIndex: layer.index,
          amount: layer.amount,
          winnerPlayerIds: layer.winner_player_ids,
        }))
      : [],
    payoutAwards: payoutMatches ? payoutAwards : {},
    refundAwards: payoutMatches ? refundAwards : {},
  };
}

interface SeatRuntime {
  chip: number;
  folded: boolean;
  allIn: boolean;
  last?: string;
  lastType?: string;
  lastAmount?: number;
  /** UAT wave 2 (trackBets): chips committed on the CURRENT street (swept to 0 at
   * each street boundary) + across the whole hand. Only maintained when the
   * `trackBets` option is on; otherwise stays 0 and is never emitted. */
  streetBet: number;
  totalBet: number;
}

/**
 * Build one immutable ReplayFrame per action index (0..N). Deterministic:
 * the same hand always yields the same frames (stepping is idempotent).
 *
 * `opts.trackBets` (UAT wave 2, viewer-only — caller gates on liveFeltCompact):
 * frame seats additionally carry `current_bet` (chips committed this street; swept
 * to 0 on the first action of a later street) and, for all-in seats,
 * `total_committed` (whole-hand chips) so the ALL-IN pill always shows an amount.
 * Amount semantics flow through `streetContribution` (potEngine — the single
 * documented DELTA source). When absent/false, neither key is emitted — frames are
 * deep-equal to today's.
 */
export function buildReplayFrames(hand: ReplayHand, opts?: { trackBets?: boolean }): ReplayFrame[] {
  const trackBets = !!opts?.trackBets;
  const actions = [...(hand.actions || [])].sort((a, b) => a.action_order - b.action_order);
  const N = actions.length;
  const players = hand.players || [];
  const positions = getHandSeatPositions(players, hand.button_seat, actions);
  const community = hand.community_cards || [];

  const pad5 = (cards: string[]): string[] => [
    ...cards,
    ...Array(Math.max(0, 5 - cards.length)).fill(""),
  ];
  const boardForStreet = (si: number): string[] => pad5(community.slice(0, boardCount(si)));

  const nameOf = (id: string) =>
    players.find((p) => p.player_id === id)?.display_name || id.slice(0, 6);
  const seatNumOf = (id: string) => players.find((p) => p.player_id === id)?.seat_number || 0;

  const runtime = new Map<string, SeatRuntime>();
  players.forEach((p) =>
    runtime.set(p.player_id, {
      chip: clampChips(p.starting_stack),
      folded: false,
      allIn: false,
      streetBet: 0,
      totalBet: 0,
    })
  );

  let maxStreetIdx = 0;

  const makeFrame = (k: number, lastAction: ReplayHandAction | null): ReplayFrame => {
    const breakdown = computePotBreakdown(
      contributionsFromActions(actions.slice(0, k) as any)
    );
    const isFinal = k === N;
    const reveal =
      isFinal && players.some((p) => p.hole_cards && p.hole_cards.length > 0);
    const streetIndex = reveal ? 4 : maxStreetIdx;
    const verifiedSettlement = isFinal && hand.publicSettlement?.status === "verified"
      ? hand.publicSettlement
      : null;
    const showdown = isFinal && reveal && !verifiedSettlement
      ? deriveShowdownResult(players, runtime, actions, community)
      : null;

    // Client reconstruction may detect a mismatch, but it is not a settlement
    // proof. Until a revision/hash-matched public outcome is supplied by the
    // server, legacy hands must not emit winners, awards, refunds or winner FX.
    const verifiedPot = verifiedSettlement
      ? verifiedSettlement.pots.reduce((sum, settledPot) => sum + settledPot.amount, 0)
      : null;
    const pot = isFinal
      ? verifiedPot ?? (breakdown.totalCommitted > 0 ? breakdown.totalPot : clampChips(hand.stored_pot_size))
      : breakdown.totalCommitted;
    const legacySettlementMismatch = !verifiedSettlement && !!showdown && !showdown.payoutMatches;
    const payoutVerified = verifiedSettlement !== null;
    const fullyRefunded = verifiedSettlement !== null && verifiedSettlement.pots.length === 0;
    const settledPlayers = new Map(verifiedSettlement?.players.map((player) => [player.playerId, player]) ?? []);
    const settledRanks = new Map(verifiedSettlement?.handRanks.map((rank) => [rank.playerId, rank]) ?? []);
    const settledWinnerIds = verifiedSettlement
      ? [...new Set(verifiedSettlement.pots.flatMap((settledPot) => settledPot.winnerIds))]
      : [];

    const seats: SeatInfo[] = players.map((p) => {
      const st = runtime.get(p.player_id)!;
      const settledPlayer = settledPlayers.get(p.player_id);
      const settledRank = settledRanks.get(p.player_id);
      return {
        player_id: p.player_id,
        display_name: p.display_name,
        seat_number: p.seat_number,
        chip_count: fullyRefunded && settledPlayer ? p.starting_stack + settledPlayer.netDelta : Math.max(0, st.chip),
        is_active: true,
        table_id: null,
        position: positions.get(p.seat_number) ?? "",
        avatar_url: p.avatar_url ?? null,
        last_action: fullyRefunded || st.folded || st.allIn ? undefined : st.last,
        last_action_type: fullyRefunded || st.folded || st.allIn ? undefined : st.lastType,
        last_action_amount: fullyRefunded || st.folded || st.allIn ? undefined : st.lastAmount,
        is_folded: st.folded,
        is_all_in: st.allIn,
        hole_cards: reveal ? p.hole_cards : undefined,
        net_won: settledPlayer?.netDelta ?? null,
        pot_winner: settledPlayer ? settledPlayer.potAward > 0 : undefined,
        payout_award: settledPlayer?.potAward,
        // Presentation baseline includes a verified refund, but no awarded pots.
        // Net delta comes from the public settlement, never a client winner calculation.
        payout_starting_stack: settledPlayer
          ? p.starting_stack + settledPlayer.netDelta - settledPlayer.potAward
          : undefined,
        refund_award: settledPlayer?.refund,
        hand_rank: settledRank
          ? { category: settledRank.category, best_five: [...settledRank.bestFive], kickers: [...settledRank.kickers] }
          : undefined,
        // trackBets only — absent keys keep flag-off frames deep-equal to today's.
        ...(trackBets ? { current_bet: fullyRefunded ? 0 : st.streetBet, display_committed_bet: fullyRefunded ? 0 : st.streetBet } : {}),
        ...(trackBets && st.allIn ? { total_committed: st.totalBet } : {}),
      };
    });

    const latestAction: ActionLog | null = lastAction
      ? {
          action_id: lastAction.action_id,
          street: lastAction.street,
          player_id: lastAction.player_id,
          display_name: nameOf(lastAction.player_id),
          seat_number: seatNumOf(lastAction.player_id),
          action_type: lastAction.action_type,
          action_amount: lastAction.action_amount,
          action_order: lastAction.action_order,
        }
      : null;

    return {
      index: k,
      seats,
      displayCards: boardForStreet(streetIndex),
      potSize: pot,
      potBreakdown: breakdown.totalCommitted > 0 ? breakdown : null,
      currentStreet: STREETS[streetIndex],
      lastActorId: latestAction?.player_id ?? null,
      latestAction,
      revealHoleCards: reveal,
      showdownResult: verifiedSettlement
        ? verifiedSettlement.pots.length > 0 && verifiedSettlement.pots.every((settledPot) => settledPot.winnerIds.length > 1)
          ? "chop"
          : "winner"
        : legacySettlementMismatch ? "needs_resettle" : null,
      showdownWinnerIds: settledWinnerIds,
      potAwards: verifiedSettlement?.pots.map((settledPot, potIndex) => ({
        potIndex,
        amount: settledPot.amount,
        winnerPlayerIds: [...settledPot.winnerIds],
      })) ?? [],
      payoutVerified,
    };
  };

  const frames: ReplayFrame[] = [makeFrame(0, null)];

  let curStreetIdx = 0;
  for (let k = 1; k <= N; k++) {
    const a = actions[k - 1];
    const st = runtime.get(a.player_id);
    // trackBets street SWEEP — hoisted ABOVE the folded-actor branch (a stray action
    // by a folded player still advances the street): the first action of a later
    // street moves every seat's street chips into the pot (current_bet → 0).
    if (trackBets) {
      const si = streetIndexOf(a.street);
      if (si > curStreetIdx) {
        curStreetIdx = si;
        runtime.forEach((r) => {
          r.streetBet = 0;
        });
      }
    }
    if (st && !st.folded) {
      maxStreetIdx = Math.max(maxStreetIdx, streetIndexOf(a.street));
      if (a.action_type === "fold") st.folded = true;
      if (a.action_type === "all_in") st.allIn = true;
      if (CONTRIBUTING.has(a.action_type)) {
        st.chip = Math.max(0, st.chip - clampChips(a.action_amount));
        if (st.chip === 0) st.allIn = true;
      }
      if (trackBets) {
        // P0.1: the DELTA semantics live in streetContribution (potEngine) — the
        // shared reconstruction source for live + replay. Never add raw inline.
        const add = streetContribution(a.action_type, a.action_amount);
        st.streetBet += add;
        st.totalBet += add;
      }
      st.last = formatActionLabel({
        street: a.street,
        player_id: a.player_id,
        display_name: "",
        seat_number: 0,
        action_type: a.action_type,
        action_amount: a.action_amount,
        action_order: a.action_order,
      });
      st.lastType = a.action_type;
      st.lastAmount = a.action_amount;
    } else if (st) {
      // A folded player should not act again; still advance street bookkeeping.
      maxStreetIdx = Math.max(maxStreetIdx, streetIndexOf(a.street));
    }
    frames.push(makeFrame(k, a));
  }

  return frames;
}

/** The frame index where each present street first appears (for street-tab jumps). */
export function streetFrameIndex(frames: ReplayFrame[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const f of frames) {
    if (!(f.currentStreet in map)) map[f.currentStreet] = f.index;
  }
  return map;
}

/** Derive the big blind from the hand's post_bb action when not supplied. */
export function detectBigBlind(hand: ReplayHand): number {
  return resolveViewerHandBigBlind({
    explicitBigBlind: hand.big_blind,
    actions: hand.actions || [],
    startingStacks: new Map((hand.players || []).map((player) => [player.player_id, clampChips(player.starting_stack)])),
  });
}
