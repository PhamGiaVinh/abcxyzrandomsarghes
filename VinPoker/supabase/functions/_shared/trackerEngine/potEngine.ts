// Tracker SERVER pot authority — recomputes main/side pots from the hand_actions
// stream so the server never trusts client-supplied side_pots.
//
// This is a verbatim copy of the pure pot math in
//   src/lib/tracker-poker/potEngine.ts   (T3A client display copy)
// kept here so the Edge runtime has a self-contained, dependency-free authority
// (Deno cannot reach into the client `@/` tree, and the client bundle must not
// import server code). The two copies are kept identical by a parity test:
//   tests/trackerEngine/potEngine.parity.test.ts
// If you change the algorithm, change BOTH files in the same PR.

export interface PotContributor {
  player_id: string;
  /** Chips committed across ALL streets. */
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

export function toSidePotsJson(breakdown: PotBreakdown): PotLayer[] {
  return breakdown.pots.map((p) => ({
    amount: p.amount,
    eligible_player_ids: p.eligible_player_ids,
  }));
}
