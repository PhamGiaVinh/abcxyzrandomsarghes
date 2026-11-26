// Pure street-by-street action breakdown for the public viewer's HandBreakdown
// panel. Turns a flat action stream into ordered per-street groups (PREFLOP /
// FLOP / TURN / RIVER / SHOWDOWN, present streets only), each carrying its
// CUMULATIVE pot (chips committed through the end of that street) and the rows
// of actions on that street. No React, no Supabase, no side effects →
// unit-testable in isolation.
//
// Action-amount convention matches the replay/T4 contract: action_amount =
// chips ADDED this street (never a raise-to total), so the running pot is the
// Σ of contributing amounts. Pot per column is CUMULATIVE through that street,
// not the street-only delta (the UI labels it as such).

import { formatActionLabel } from "@/components/cashier/tournament-live/LiveFelt";
import { formatViewerBBOrUnavailable } from "./viewerAmounts";

const STREETS = ["preflop", "flop", "turn", "river", "showdown"];
// Action types that put chips in the pot (same set the replay/pot engines use).
const CONTRIBUTING = new Set([
  "bet",
  "raise",
  "call",
  "all_in",
  "post_sb",
  "post_bb",
  "post_ante",
]);

export interface BreakdownAction {
  player_id: string;
  street: string;
  /** Chips added this street (null/undefined → 0). */
  action_amount: number | null;
  action_type: string;
  action_order: number;
}

export interface BreakdownRow {
  player_id: string;
  action_type: string;
  action_amount: number;
  action_order: number;
  /** Localized-neutral action label, e.g. "Raise 1.5k" (via formatActionLabel). */
  label: string;
  /** Amount in big blinds, only when bigBlind > 0 AND the action moved chips. */
  amountBB: number | null;
}

export interface BreakdownStreet {
  street: string;
  /** Cumulative pot (chips) committed through the END of this street. */
  potChips: number;
  /** potChips in big blinds, only when bigBlind > 0. */
  potBB: number | null;
  rows: BreakdownRow[];
}

function clamp0(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : 0;
  return v > 0 ? v : 0;
}

function streetIdx(s: string): number {
  const i = STREETS.indexOf(s);
  return i < 0 ? 0 : i;
}

/** Two display decimals at most. null when bb ≤ 0. */
function toBB(chips: number, bb: number): number | null {
  if (bb <= 0) return null;
  return Number((chips / bb).toFixed(2));
}

/**
 * Group a hand's actions into ordered present-street columns with a cumulative
 * pot per column. Rows within a street are sorted by action_order. Streets with
 * no actions are omitted. `bigBlind` ≤ 0 → all BB fields are null (chips only).
 */
export function deriveHandBreakdown(
  actions: BreakdownAction[],
  bigBlind: number,
  formatAmount?: (amount: number) => string,
): BreakdownStreet[] {
  const bb = clamp0(bigBlind);
  const sorted = [...(actions || [])].sort(
    (a, b) => streetIdx(a.street) - streetIdx(b.street) || a.action_order - b.action_order,
  );

  const rowsByStreet = new Map<string, BreakdownRow[]>();
  const potThroughStreet = new Map<string, number>();
  let runningPot = 0;

  for (const a of sorted) {
    const street = STREETS.includes(a.street) ? a.street : "preflop";
    const amt = clamp0(a.action_amount);
    if (CONTRIBUTING.has(a.action_type)) runningPot += amt;

    const label = formatActionLabel({
      street,
      player_id: a.player_id,
      display_name: "",
      seat_number: 0,
      action_type: a.action_type,
      action_amount: amt,
      action_order: a.action_order,
    }, formatAmount ?? ((amount) => formatViewerBBOrUnavailable(amount, bb)));

    const row: BreakdownRow = {
      player_id: a.player_id,
      action_type: a.action_type,
      action_amount: amt,
      action_order: a.action_order,
      label,
      amountBB: amt > 0 ? toBB(amt, bb) : null,
    };

    if (!rowsByStreet.has(street)) rowsByStreet.set(street, []);
    rowsByStreet.get(street)!.push(row);
    // Last write per street wins → cumulative pot through the end of that street.
    potThroughStreet.set(street, runningPot);
  }

  return STREETS.filter((s) => rowsByStreet.has(s)).map((s) => {
    const pot = potThroughStreet.get(s) ?? 0;
    return { street: s, potChips: pot, potBB: toBB(pot, bb), rows: rowsByStreet.get(s)! };
  });
}
