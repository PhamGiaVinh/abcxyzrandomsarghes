// Pure derivations for the RPT-Live-style spectator HAND FEED (one card per
// completed hand). No React, no Supabase — fully unit-testable. The hook
// (useCompletedHandsFeed) fetches the persisted rows and feeds them through here.
//
// READ-ONLY: every field is derived from already-persisted, operator-recorded data
// (tournament_hands / hand_players / hand_actions / tournament_eliminations).
// Reuses the canonical pot/replay utilities. Winner and ranking labels are copied
// only from the server-authoritative public settlement for this exact hand.
//
// 🟢 HOLE-CARD GUARANTEE (structural): `hand_players.hole_cards` is persisted ONLY
// when the operator reveals cards at showdown/runout — i.e. cards that were already
// physically face-up at the table. There is NO hidden / RFID hole-card source, and
// this feed shows COMPLETED hands only. So the viewer can never know more than the
// table already showed → no leak, no broadcast delay needed. HIGH HAND is shown
// only when the verified settlement also supplies its public ranking.
// ⚠️ If an RFID / hole-card-camera feed is ever added as a hole-card source, this
// guarantee BREAKS — a broadcast delay + reveal policy would become mandatory.

import { computePotBreakdown, contributionsFromActions } from "@/lib/tracker-poker/potEngine";
import { buildReplayFrames } from "@/lib/tracker-poker/replayEngine";
import type { ReplayPublicSettlement } from "@/lib/tracker-poker/replaySettlement";
import { formatVerifiedHandRanking } from "@/lib/tracker-poker/replayBestFiveFocus";
import { resolveViewerHandBigBlind } from "@/lib/tracker-poker/viewerAmounts";
import { resolveViewerIdentity } from "./viewerIdentity";
import type { ViewerActionItem, ViewerStreet } from "./viewerTypes";

export type HandFeedTag = "all_in" | "big_pot" | "high_hand" | "eliminated";

export type HandCategory =
  | "royal_flush"
  | "straight_flush"
  | "quads"
  | "full_house"
  | "flush"
  | "straight"
  | "trips"
  | "two_pair"
  | "pair"
  | "high_card";

export const CATEGORY_RANK: Record<HandCategory, number> = {
  high_card: 0,
  pair: 1,
  two_pair: 2,
  trips: 3,
  straight: 4,
  flush: 5,
  full_house: 6,
  quads: 7,
  straight_flush: 8,
  royal_flush: 9,
};

// ── Raw row shapes (what the hook fetches; kept loose for forward-compat) ──────────
export interface RawHandRow {
  tracker_big_blind?: number | null;
  id: string;
  hand_number: number;
  created_at: string;
  community_cards: string[] | null;
  pot_size: number | null;
  button_seat: number | null;
  table_id: string | null;
  publicSettlement?: ReplayPublicSettlement | null;
  settlementUnavailable?: boolean;
}
export interface RawHandPlayer {
  hand_id: string;
  player_id: string;
  seat_number: number;
  starting_stack: number | null;
  ending_stack: number | null;
  hole_cards: string[] | null;
  is_eliminated: boolean | null;
  /** E1 per-hand snapshot (hand_players.player_name/avatar_url); undefined pre-apply. */
  player_name?: string | null;
  avatar_url?: string | null;
}
export interface RawHandAction {
  id?: string;
  hand_id: string;
  player_id: string;
  street?: string | null;
  action_type: string;
  action_amount: number | null;
  action_order: number;
}
export interface RawElimination {
  hand_id: string;
  player_id: string;
  position: number | null;
  prize: number | null;
}
export interface RawProfile {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
}

// ── View-model the card renders ──────────────────────────────────────────────────
export interface HandFeedPlayer {
  playerId: string;
  seatNumber: number;
  name: string;
  avatarUrl: string | null;
  endingStack: number | null;
  deltaChips: number;
  deltaBB: number | null;
  /** Revealed display cards (e.g. "A♥"), or null when never revealed (face-down). */
  holeCards: string[] | null;
  isWinner: boolean;
  isEliminated: boolean;
  finishPosition: number | null;
  prize: number | null;
  rankingText?: string | null;
}
export interface HandFeedItem {
  verificationStatus?: "verified" | "unverified" | "unavailable";
  handId: string;
  handNumber: number;
  tableId: string | null;
  createdAt: string;
  board: string[];
  potChips: number;
  potBB: number | null;
  sidePotCount: number;
  bigBlind: number;
  tags: HandFeedTag[];
  players: HandFeedPlayer[];
  highHand: { playerId: string; category: HandCategory } | null;
  actions?: ViewerActionItem[];
  showdownResult?: "winner" | "chop" | "needs_resettle" | null;
}

export interface BuildHandFeedOptions {
  /** BIG POT fires when totalPot >= this × BB (default 40). */
  bigPotThresholdBB?: number;
  /** HIGH HAND fires when the best revealed hand's rank >= this (default straight). */
  highHandFloor?: HandCategory;
  viewerPulseV2?: boolean;
}

function clampChips(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : 0;
  return v > 0 ? v : 0;
}

/** Big blind from the hand's post_bb action (0 when none). Inlined to keep this
 *  module free of the React-coupled replayEngine import. */
export function bigBlindFromActions(actions: RawHandAction[]): number {
  return resolveViewerHandBigBlind({ actions });
}

/** Legacy score-category adapter kept for callers that already own an evaluator score. */
export function scoreToCategory(score: number): HandCategory {
  const band = Math.floor(score / 1e10);
  switch (band) {
    case 8:
      return score - 8e10 === 14 ? "royal_flush" : "straight_flush";
    case 7:
      return "quads";
    case 6:
      return "full_house";
    case 5:
      return "flush";
    case 4:
      return "straight";
    case 3:
      return "trips";
    case 2:
      return "two_pair";
    case 1:
      return "pair";
    default:
      return "high_card";
  }
}

function settlementCategory(value: string): HandCategory | null {
  const aliases: Record<string, HandCategory> = {
    royal_flush: "royal_flush", straight_flush: "straight_flush", four_of_a_kind: "quads", quads: "quads",
    full_house: "full_house", flush: "flush", straight: "straight", three_of_a_kind: "trips", trips: "trips",
    two_pair: "two_pair", one_pair: "pair", pair: "pair", high_card: "high_card",
  };
  return aliases[value.trim().toLowerCase()] ?? null;
}

/** Build the feed cards from grouped persisted rows (newest-first order preserved). */
export function buildHandFeedItems(
  hands: RawHandRow[],
  playersByHand: Map<string, RawHandPlayer[]>,
  actionsByHand: Map<string, RawHandAction[]>,
  elimsByHand: Map<string, RawElimination[]>,
  profiles: Map<string, RawProfile>,
  opts: BuildHandFeedOptions = {},
): HandFeedItem[] {
  const bigPotThresholdBB = opts.bigPotThresholdBB ?? 40;
  const highHandFloor = CATEGORY_RANK[opts.highHandFloor ?? "straight"];
  const viewerPulseV2 = opts.viewerPulseV2 === true;

  return hands.map((h) => {
    const actions = actionsByHand.get(h.id) ?? [];
    const rawPlayers = playersByHand.get(h.id) ?? [];
    const elims = elimsByHand.get(h.id) ?? [];
    const board = (h.community_cards ?? []).filter((c): c is string => !!c);

    const bb = resolveViewerHandBigBlind({
      explicitBigBlind: h.tracker_big_blind,
      actions,
      startingStacks: new Map(rawPlayers.map((player) => [player.player_id, clampChips(player.starting_stack)])),
    });
    const breakdown = computePotBreakdown(contributionsFromActions(actions));
    const potChips = breakdown.totalPot > 0 ? breakdown.totalPot : clampChips(h.pot_size);
    const potBB = bb > 0 ? Number((potChips / bb).toFixed(2)) : null;

    const elimByPlayer = new Map(elims.map((e) => [e.player_id, e]));
    const verifiedRanks = h.publicSettlement?.status === "verified" ? h.publicSettlement.handRanks : [];
    const highHand = verifiedRanks.reduce<{ playerId: string; category: HandCategory } | null>((best, rank) => {
      const category = settlementCategory(rank.category);
      if (!category || (best && CATEGORY_RANK[best.category] >= CATEGORY_RANK[category])) return best;
      return { playerId: rank.playerId, category };
    }, null);

    const replayFrames = viewerPulseV2 ? buildReplayFrames({
      hand_id: h.id,
      hand_number: h.hand_number,
      button_seat: h.button_seat ?? 0,
      community_cards: board,
      stored_pot_size: h.pot_size,
      big_blind: bb,
      players: rawPlayers.map((p) => ({
        player_id: p.player_id,
        seat_number: p.seat_number,
        display_name: p.player_name || profiles.get(p.player_id)?.display_name || "",
        starting_stack: clampChips(p.starting_stack),
        ending_stack: p.ending_stack,
        avatar_url: p.avatar_url ?? profiles.get(p.player_id)?.avatar_url ?? null,
        hole_cards: p.hole_cards ?? undefined,
      })),
      actions: actions.map((a) => ({
        action_id: a.id,
        player_id: a.player_id,
        street: a.street || "preflop",
        action_type: a.action_type,
        action_amount: clampChips(a.action_amount),
        action_order: a.action_order,
      })),
      publicSettlement: h.publicSettlement,
    }) : [];
    const finalFrame = replayFrames.at(-1);
    const verifiedWinnerIds = new Set(finalFrame?.payoutVerified ? finalFrame.showdownWinnerIds ?? [] : []);
    const showdownResult = finalFrame?.showdownResult ?? null;

    const players: HandFeedPlayer[] = rawPlayers
      .map((p) => {
        const prof = profiles.get(p.player_id);
        const identity = viewerPulseV2 ? resolveViewerIdentity({
          playerId: p.player_id,
          seatNumber: p.seat_number,
          snapshotName: p.player_name,
          snapshotAvatarUrl: p.avatar_url,
          profileName: prof?.display_name,
          profileAvatarUrl: prof?.avatar_url,
        }) : {
          name: p.player_name || prof?.display_name || p.player_id.slice(0, 6),
          avatarUrl: p.avatar_url ?? prof?.avatar_url ?? null,
        };
        const start = clampChips(p.starting_stack);
        const end = p.ending_stack == null ? null : clampChips(p.ending_stack);
        const deltaChips = end == null ? 0 : end - start;
        const elim = elimByPlayer.get(p.player_id);
        const hole = (p.hole_cards ?? []).filter((c): c is string => !!c);
        return {
          playerId: p.player_id,
          seatNumber: p.seat_number,
          name: identity.name,
          avatarUrl: identity.avatarUrl,
          endingStack: end,
          deltaChips,
          deltaBB: bb > 0 && end != null ? Number((deltaChips / bb).toFixed(2)) : null,
          holeCards: hole.length > 0 ? hole : null,
          // A positive stack delta is not proof of winning a pot (refunds and
          // corrections can also increase a stack). Fail closed until the verified
          // settlement path is enabled.
          isWinner: viewerPulseV2 && verifiedWinnerIds.has(p.player_id),
          isEliminated: !!elim || p.is_eliminated === true,
          finishPosition: elim?.position ?? null,
          prize: elim?.prize ?? null,
          rankingText: viewerPulseV2 && verifiedWinnerIds.has(p.player_id)
            ? (() => {
                const rank = verifiedRanks.find((candidate) => candidate.playerId === p.player_id);
                return rank ? formatVerifiedHandRanking({
                  category: rank.category,
                  bestFive: rank.bestFive,
                  kickers: rank.kickers,
                }) : null;
              })()
            : null,
        };
      })
      .sort((a, b) => b.deltaChips - a.deltaChips);

    // Focus the card on the pot's participants (winners / losers / busts / revealers).
    const involved = players.filter(
      (p) => p.deltaChips !== 0 || p.holeCards || p.isEliminated,
    );
    const shown = involved.length > 0 ? involved : players;

    const tags: HandFeedTag[] = [];
    if (actions.some((a) => a.action_type === "all_in")) tags.push("all_in");
    if (bb > 0 && potChips >= bigPotThresholdBB * bb) tags.push("big_pot");
    if (highHand && CATEGORY_RANK[highHand.category] >= highHandFloor) tags.push("high_hand");
    if (elims.length > 0 || rawPlayers.some((p) => p.is_eliminated === true)) tags.push("eliminated");

    const playerById = new Map(players.map((player) => [player.playerId, player]));
    const viewerActions: ViewerActionItem[] = [...actions]
      .sort((a, b) => a.action_order - b.action_order)
      .map((action, index) => {
        const player = playerById.get(action.player_id);
        return {
          actionId: action.id || `${h.id}:${action.action_order}`,
          playerId: action.player_id,
          playerName: player?.name ?? "Người chơi",
          avatarUrl: player?.avatarUrl ?? null,
          seatNumber: player?.seatNumber ?? 0,
          street: (["preflop", "flop", "turn", "river", "showdown"].includes(action.street || "")
            ? action.street
            : "preflop") as ViewerStreet,
          actionType: action.action_type,
          amount: clampChips(action.action_amount),
          potAfter: replayFrames[index + 1]?.potSize ?? 0,
          actionOrder: action.action_order,
        };
      });

    return {
      verificationStatus: h.settlementUnavailable ? "unavailable" : h.publicSettlement?.status === "verified" ? "verified" : "unverified",
      handId: h.id,
      handNumber: h.hand_number,
      tableId: h.table_id,
      createdAt: h.created_at,
      board,
      potChips,
      potBB,
      sidePotCount: breakdown.sidePots.length,
      bigBlind: bb,
      tags,
      players: shown,
      highHand,
      actions: viewerPulseV2 ? viewerActions : undefined,
      showdownResult: viewerPulseV2 ? showdownResult : undefined,
    };
  });
}

/** Keep only items carrying at least one of the selected tags (empty = no filter). */
export function filterByTags(items: HandFeedItem[], tags: HandFeedTag[]): HandFeedItem[] {
  if (!tags.length) return items;
  const want = new Set(tags);
  return items.filter((it) => it.tags.some((t) => want.has(t)));
}
