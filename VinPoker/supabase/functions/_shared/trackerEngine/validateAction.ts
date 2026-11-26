// Tracker action validator — the server's authority on whether an operator's
// proposed action is a legal No-Limit Hold'em action given the reconstructed
// hand state. Pure; returns a structured verdict the Edge function turns into a
// 422 (enforce mode) or an advisory field (warn mode).

import type {
  ActionRow,
  PlayerSeed,
  ProposedAction,
  ValidationResult,
} from "./types.ts";
import { STREET_ORDER } from "./types.ts";
import {
  findPlayer,
  hasRaiseRights,
  isBettingRoundComplete,
  isRunout,
  nextToAct,
  nextToActAtStreet,
  reduceHand,
} from "./handState.ts";
import {
  computePotBreakdown,
  contributionsFromActions,
  toSidePotsJson,
  type PotLayer,
} from "./potEngine.ts";

function ok(normalizedAmount: number): ValidationResult {
  return { valid: true, code: "OK", message: "", normalizedAmount };
}

function fail(
  code: ValidationResult["code"],
  message: string,
  normalizedAmount = 0,
): ValidationResult {
  return { valid: false, code, message, normalizedAmount };
}

function streetIndex(s: string): number {
  const i = STREET_ORDER.indexOf(s as never);
  return i === -1 ? 0 : i;
}

/**
 * Validate a single proposed action against the prior (trusted) action stream.
 * `enforceTurnOrder` lets the caller relax clockwise ordering for live entry
 * while still enforcing the hard physical invariants (folded/all-in/stack/etc.).
 */
export function validateAction(
  seeds: PlayerSeed[],
  priorActions: ActionRow[],
  buttonSeat: number,
  proposed: ProposedAction,
  opts: { enforceTurnOrder?: boolean } = {},
): ValidationResult {
  const runtime = reduceHand(seeds, priorActions, buttonSeat);
  const player = findPlayer(runtime, proposed.player_id);

  if (!player) {
    return fail("PLAYER_NOT_IN_HAND", "Người chơi không thuộc hand này.");
  }
  if (player.is_folded) {
    return fail("PLAYER_FOLDED", "Người chơi đã fold, không thể hành động.");
  }
  if (player.is_all_in) {
    return fail("PLAYER_ALL_IN", "Người chơi đã all-in, không thể hành động thêm.");
  }

  if (runtime.players.filter((candidate) => !candidate.is_folded).length <= 1) {
    return fail("HAND_NOT_ACTIVE", "Hand đã kết thúc sau khi chỉ còn một người chơi.");
  }
  if (proposed.street === "showdown") {
    return fail("ILLEGAL_ACTION_TYPE", "Không ghi hành động cược ở street showdown.");
  }

  const proposedStreet = streetIndex(proposed.street);
  const currentStreet = streetIndex(runtime.street);
  if (proposedStreet < currentStreet || proposedStreet > currentStreet + 1) {
    return fail("INVALID_STREET_PROGRESSION", "Street của hành động không theo đúng thứ tự.");
  }

  // Street-advance guard: an action on a later street while the current street
  // still has players owing action means the street was advanced prematurely.
  if (
    streetIndex(proposed.street) > streetIndex(runtime.street) &&
    !isBettingRoundComplete(runtime)
  ) {
    return fail(
      "STREET_ACTION_PENDING",
      "Chưa thể sang street mới — vẫn còn người chưa hành động.",
    );
  }

  // First action of a later street: the prior street's betting is closed, so
  // validate against a FRESH street — reset street commitments and reset the
  // min-bet bar to one big blind. (total_bet / stack carry over untouched.)
  if (streetIndex(proposed.street) > streetIndex(runtime.street)) {
    for (const p of runtime.players) {
      p.street_bet = 0;
      p.has_acted_this_street = false;
      p.last_action_wager_level = null;
      p.can_raise = true;
    }
    runtime.highestBet = 0;
    runtime.minRaise = runtime.bigBlind;
  }

  if (
    !["post_sb", "post_bb", "post_ante"].includes(proposed.action_type) &&
    isRunout(runtime) && runtime.highestBet <= player.street_bet
  ) {
    return fail("HAND_NOT_ACTIVE", "Hand đã sang trạng thái runout; không còn cược cần theo.");
  }

  if (opts.enforceTurnOrder && !["post_sb", "post_bb", "post_ante"].includes(proposed.action_type)) {
    const turn = proposedStreet > currentStreet
      ? nextToActAtStreet(seeds, priorActions, buttonSeat, proposed.street)
      : nextToAct(seeds, priorActions, buttonSeat);
    if (!turn) {
      return fail("HAND_NOT_ACTIVE", "Không còn người chơi cần hành động ở street này.");
    }
    if (turn !== proposed.player_id) {
      return fail("OUT_OF_TURN", "Chưa tới lượt người chơi này.");
    }
  }

  const toCall = Math.max(0, runtime.highestBet - player.street_bet);
  const amt = Math.floor(Number.isFinite(proposed.action_amount) ? proposed.action_amount : 0);

  switch (proposed.action_type) {
    case "fold":
      return ok(0);

    case "check":
      if (toCall > 0) {
        return fail("CHECK_FACING_BET", "Không thể check khi đang có cược phải theo.");
      }
      return ok(0);

    case "call": {
      if (toCall <= 0) {
        return fail("CALL_WITH_NOTHING_TO_CALL", "Không có cược nào để call.");
      }
      // A call is capped at the stack (short call = all-in for less).
      return ok(Math.min(toCall, player.stack));
    }

    case "bet": {
      if (runtime.highestBet > 0) {
        return fail("BET_WHEN_FACING_BET", "Đang có cược — phải raise thay vì bet.");
      }
      if (amt <= 0) return fail("NON_POSITIVE_AMOUNT", "Số chip phải lớn hơn 0.");
      if (amt > player.stack) {
        return fail("AMOUNT_EXCEEDS_STACK", "Cược vượt quá stack của người chơi.");
      }
      const isAllIn = amt === player.stack;
      if (!isAllIn && amt < runtime.minRaise) {
        return fail(
          "BELOW_MIN_RAISE",
          `Bet tối thiểu là ${runtime.minRaise}.`,
          amt,
        );
      }
      return ok(amt);
    }

    case "raise": {
      if (runtime.highestBet <= 0) {
        return fail("RAISE_WITHOUT_BET", "Chưa có cược nào — dùng bet thay vì raise.");
      }
      if (!hasRaiseRights(runtime, player)) {
        return fail("ACTION_NOT_REOPENED", "Action chưa được mở lại để người chơi này raise.");
      }
      if (amt <= 0) return fail("NON_POSITIVE_AMOUNT", "Số chip phải lớn hơn 0.");
      if (amt > player.stack) {
        return fail("AMOUNT_EXCEEDS_STACK", "Raise vượt quá stack của người chơi.");
      }
      const raiseToStreetBet = player.street_bet + amt;
      const increment = raiseToStreetBet - runtime.highestBet;
      const isAllIn = amt === player.stack;
      if (increment <= 0) {
        return fail("BELOW_MIN_RAISE", "Raise phải cao hơn mức cược hiện tại.", amt);
      }
      if (!isAllIn && increment < runtime.minRaise) {
        return fail(
          "BELOW_MIN_RAISE",
          `Raise tối thiểu thêm ${runtime.minRaise} (chưa tính phần call).`,
          amt,
        );
      }
      return ok(amt);
    }

    case "all_in": {
      if (player.stack <= 0) {
        return fail("AMOUNT_EXCEEDS_STACK", "Người chơi không còn chip để all-in.");
      }
      if (player.street_bet + player.stack > runtime.highestBet && !hasRaiseRights(runtime, player)) {
        return fail("ACTION_NOT_REOPENED", "Action chưa được mở lại để người chơi này raise all-in.");
      }
      return ok(player.stack);
    }

    case "post_sb":
    case "post_bb":
    case "post_ante": {
      // Posts are operator setup — clamp to stack, no legality gate.
      if (amt <= 0) return fail("NON_POSITIVE_AMOUNT", "Mức post phải lớn hơn 0.");
      return ok(Math.min(amt, player.stack));
    }

    default:
      return fail("ILLEGAL_ACTION_TYPE", "Loại hành động không hợp lệ.");
  }
}

export interface SidePotReconciliation {
  /** Authoritative side pots recomputed from the action stream. */
  serverSidePots: PotLayer[];
  /** True when the client-sent side_pots disagree with the server recompute. */
  tampered: boolean;
}

/**
 * Recompute side pots from the trusted action stream and compare against what
 * the client submitted. The server value is always authoritative; `tampered`
 * tells the Edge function whether to reject (enforce) or silently override (warn).
 */
export function reconcileSidePots(
  actions: ActionRow[],
  clientSidePots: unknown,
  bigBlindAntePlayerId?: string,
): SidePotReconciliation {
  const breakdown = computePotBreakdown(contributionsFromActions(actions, bigBlindAntePlayerId));
  const serverSidePots = toSidePotsJson(breakdown);

  let parsed: unknown = clientSidePots;
  if (typeof clientSidePots === "string") {
    try {
      parsed = JSON.parse(clientSidePots);
    } catch {
      parsed = null;
    }
  }

  const tampered = !sidePotsEqual(parsed, serverSidePots);
  return { serverSidePots, tampered };
}

function sidePotsEqual(a: unknown, b: PotLayer[]): boolean {
  if (!Array.isArray(a)) return b.length === 0;
  if (a.length !== b.length) return false;
  for (let i = 0; i < b.length; i++) {
    const x = a[i] as { amount?: unknown; eligible_player_ids?: unknown };
    if (!x || Math.floor(Number(x.amount)) !== b[i].amount) return false;
    const xs = Array.isArray(x.eligible_player_ids) ? [...x.eligible_player_ids].sort() : [];
    const ys = [...b[i].eligible_player_ids].sort();
    if (xs.length !== ys.length || xs.some((v, k) => v !== ys[k])) return false;
  }
  return true;
}
