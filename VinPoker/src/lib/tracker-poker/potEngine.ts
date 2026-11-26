// Tracker Engine Adapter — pure pot math for the Tournament Live Tracker.
//
// Algorithm adapted from the GE-1 pure engine (supabase/functions/_shared/
// pokerEngine/pots.ts). The engine itself is deliberately NOT importable from
// the client bundle (server-authoritative guardrail in vitest.config.ts), so
// this module re-implements only the calculation layer with plain numbers:
// side-pot layering from per-player total contributions, plus uncalled-bet
// detection. No deck, no shuffle, no winner logic — calculation only.
//
// Invariant: sum(pots[].amount) + (uncalled?.amount ?? 0) === sum(total_bet).

export interface PotContributor {
  player_id: string;
  /** Chips committed across ALL streets (HandInputPanel `total_bet`). */
  total_bet: number;
  big_blind_ante?: number;
  is_folded: boolean;
}

export interface PotLayer {
  amount: number;
  /** Non-folded players who can win this layer. Folded chips stay as dead money. */
  eligible_player_ids: string[];
}

export interface UncalledBet {
  player_id: string;
  amount: number;
}

export interface PotBreakdown {
  /** Post-refund pot layers; pots[0] is the main pot. Empty when nothing committed. */
  pots: PotLayer[];
  sidePots: PotLayer[];
  mainPot: number;
  /**
   * The top portion of the largest commitment no other player matched. In live
   * play this is provisional until betting closes — the UI should phrase it as
   * "will be returned if nobody calls". Refund is only attributed to a
   * non-folded player; a folded over-contribution stays in the pot as dead money.
   */
  uncalled: UncalledBet | null;
  /** Sum of pot layers (after uncalled refund). */
  totalPot: number;
  /** Raw sum of contributions (before refund). */
  totalCommitted: number;
}

const EMPTY: PotBreakdown = {
  pots: [],
  sidePots: [],
  mainPot: 0,
  uncalled: null,
  totalPot: 0,
  totalCommitted: 0,
};

/** Action types that move chips into the pot — must match HandInputPanel's potSize sum. */
export const CONTRIBUTING_ACTION_TYPES = [
  "bet",
  "raise",
  "call",
  "all_in",
  "post_sb",
  "post_bb",
  "post_ante",
] as const;

function sanitizeChips(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : 0;
  return v > 0 ? v : 0;
}

function sameMembers(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

/**
 * Build main + side pots from each player's total commitment.
 *
 * 1. Detect the uncalled bet: if exactly one player committed strictly more
 *    than everyone else and is not folded, the excess was never matched and is
 *    refunded (removed from the layers).
 * 2. Layer the remaining contributions at each distinct commitment level
 *    (ascending): layer amount = (level - prevLevel) x contributors at >= level;
 *    eligible = non-folded contributors at >= level.
 */
export function computePotBreakdown(contributors: PotContributor[]): PotBreakdown {
  const active = contributors
    .map((c) => ({ ...c, total_bet: sanitizeChips(c.total_bet) }))
    .filter((c) => c.total_bet > 0);
  if (active.length === 0) return EMPTY;

  const totalCommitted = active.reduce((s, c) => s + c.total_bet, 0);

  // A big-blind ante belongs to the main pot. Only live wagers can be uncalled.
  let ante = 0;
  for (const player of active) {
    const paid = Math.min(player.total_bet, sanitizeChips(player.big_blind_ante));
    player.total_bet -= paid;
    ante += paid;
  }
  const sorted = [...active].sort((a, b) => b.total_bet - a.total_bet);
  const top = sorted[0];
  const second = sorted[1]?.total_bet ?? 0;

  let uncalled: UncalledBet | null = null;
  const effective = new Map<string, number>();
  active.forEach((c) => effective.set(c.player_id, c.total_bet));
  if (top.total_bet > second && !top.is_folded) {
    uncalled = { player_id: top.player_id, amount: top.total_bet - second };
    effective.set(top.player_id, second);
  }

  const levels = [...new Set([...effective.values()].filter((v) => v > 0))].sort(
    (a, b) => a - b
  );

  const pots: PotLayer[] = [];
  let prev = 0;
  for (const level of levels) {
    let count = 0;
    const eligible: string[] = [];
    for (const c of active) {
      if ((effective.get(c.player_id) ?? 0) >= level) {
        count++;
        if (!c.is_folded) eligible.push(c.player_id);
      }
    }
    const amount = (level - prev) * count;
    if (amount > 0) {
      // A folded player's contribution level must not split the pot: merge into
      // the previous layer when the eligible set is unchanged (a real side pot
      // only forms at a LIVE player's all-in cap).
      const last = pots[pots.length - 1];
      if (last && sameMembers(last.eligible_player_ids, eligible)) {
        last.amount += amount;
      } else {
        pots.push({ amount, eligible_player_ids: eligible });
      }
    }
    prev = level;
  }

  if (ante > 0) {
    const eligible = active.filter(player => !player.is_folded).map(player => player.player_id);
    if (pots[0] && sameMembers(pots[0].eligible_player_ids, eligible)) pots[0].amount += ante;
    else pots.unshift({ amount: ante, eligible_player_ids: eligible });
  }

  return {
    pots,
    sidePots: pots.slice(1),
    mainPot: pots[0]?.amount ?? 0,
    uncalled,
    totalPot: pots.reduce((s, p) => s + p.amount, 0),
    totalCommitted,
  };
}

/**
 * P0.1 (UAT wave 2) — THE single place that encodes `action_amount` semantics for
 * bet reconstruction (live viewer + replay both call this; never add "raw" inline).
 *
 * PROVEN: `action_amount` is a DELTA — the chips ADDED by that action — for EVERY
 * action type. Five independent sources:
 *  1. Client write-path: `betToAdded(betTo, streetCommitted, stack)` →
 *     `added = min(betTo − streetCommitted, stack)`; handleAction sends `added`.
 *  2. Pinned test: racetrackPayloadParity — "raise to 1000 (committed 200) → 800".
 *  3. Server validator (_shared/trackerEngine/validateAction.ts): raise checks
 *     `raiseToStreetBet = player.street_bet + amt`; call stores `min(toCall, stack)`;
 *     bet fails on `amt > stack`; all_in stores `player.stack`; posts clamp to stack.
 *  4. replayEngine decrements stacks by `action_amount` → correct ending stacks.
 *  5. contributionsFromActions sums amounts → pot matches server `pot_size`.
 *
 * Per action_type: post_sb/post_bb/post_ante = posted delta (stack-clamped) ·
 * call = delta added to match · bet = delta (== street total when opening) ·
 * raise = delta ON TOP of the player's prior street commitment · all_in = the
 * remaining stack shoved. Non-contributing types (fold/check/…) return 0.
 *
 * If the wire format ever changes to raise-to/total semantics, fix it HERE (compute
 * `amount − previousStreetBet`) — every reconstruction downstream follows.
 */
export function streetContribution(actionType: string, actionAmount: number | null): number {
  if (!(CONTRIBUTING_ACTION_TYPES as readonly string[]).includes(actionType)) return 0;
  return sanitizeChips(actionAmount);
}

/**
 * Derive per-player contributions from a hand_actions stream (viewer side —
 * the viewer has no stack state, only the action log).
 */
export function contributionsFromActions(
  actions: { player_id: string; action_type: string; action_amount: number | null }[],
  bigBlindAntePlayerId?: string,
): PotContributor[] {
  const byPlayer = new Map<string, PotContributor>();
  for (const a of actions) {
    let c = byPlayer.get(a.player_id);
    if (!c) {
      c = { player_id: a.player_id, total_bet: 0, is_folded: false };
      byPlayer.set(a.player_id, c);
    }
    if ((CONTRIBUTING_ACTION_TYPES as readonly string[]).includes(a.action_type)) {
      c.total_bet += sanitizeChips(a.action_amount);
    }
    if (a.action_type === "post_ante" && a.player_id === bigBlindAntePlayerId) {
      c.big_blind_ante = (c.big_blind_ante ?? 0) + sanitizeChips(a.action_amount);
    }
    if (a.action_type === "fold") c.is_folded = true;
  }
  return [...byPlayer.values()];
}

/** Shape persisted into live/tournament hands `side_pots JSONB` via record_hand. */
export function toSidePotsJson(breakdown: PotBreakdown): PotLayer[] {
  return breakdown.pots.map((p) => ({
    amount: p.amount,
    eligible_player_ids: p.eligible_player_ids,
  }));
}
