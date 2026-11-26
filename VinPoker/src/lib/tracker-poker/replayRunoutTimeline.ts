import { showdownRevealOrder } from "./trackerEngine";

export const SHOWDOWN_FIRST_FLIP_MS = 350;
export const SHOWDOWN_SEAT_INTERVAL_MS = 500;

export function orderedShowdownPlayers(
  players: { player_id: string; seat_number: number }[],
  actions: { player_id: string; action_type: string; street: string; action_order: number }[],
  buttonSeat: number,
): string[] | undefined {
  if (players.length < 2) return undefined;
  const seatToPlayer = new Map(players.map(player => [player.seat_number, player.player_id]));
  const bettingActions = actions
    .filter(action => ["check", "fold", "call", "bet", "raise", "all_in"].includes(action.action_type))
    .sort((a, b) => b.action_order - a.action_order);
  const finalStreet = bettingActions[0]?.street;
  const aggressor = bettingActions.find(action =>
    action.street === finalStreet && ["bet", "raise", "all_in"].includes(action.action_type),
  );
  return showdownRevealOrder({
    shownSeatNumbers: [...seatToPlayer.keys()],
    buttonSeat,
    finalAggressorSeat: players.find(player => player.player_id === aggressor?.player_id)?.seat_number,
  }).map(seat => seatToPlayer.get(seat)!);
}

export function showdownRevealDelay(index: number, speed: number): number {
  return Math.round((SHOWDOWN_FIRST_FLIP_MS + index * SHOWDOWN_SEAT_INTERVAL_MS) / speed);
}

export const ALL_IN_HOLE_REVEAL_HOLD_MS = 650;
export const FLOP_CARD_STAGGER_MS = 90;
export const FLOP_REVEAL_TOTAL_MS = 450;
export const FLOP_READ_HOLD_MS = 900;
export const TURN_REVEAL_MS = 300;
export const TURN_READ_HOLD_MS = 800;
export const RIVER_REVEAL_MS = 500;
export const RIVER_RESULT_HOLD_MS = 350;
export const POT_COLLECT_MS = 420;
// Keep every verified pot result readable before moving to the next side pot.
// The replay only uses this for server-projected settlement allocations.
export const POT_AWARD_TRAVEL_MS = 420;
export const POT_AWARD_MS = POT_AWARD_TRAVEL_MS + 3_000;
export const BEST_FIVE_DIM_MS = 180;
export const BEST_FIVE_GLOW_MS = 320;
export const SUMMARY_RANKING_DELAY_MS = 120;
export const RESULT_HOLD_MS = 2_000;

export type ReplayRunoutPhase =
  | "hole_hold"
  | "flop"
  | "turn"
  | "river"
  | "pot_collect"
  | "pot_award"
  | "dim"
  | "glow"
  | "summary_delay"
  | "summary"
  | "static";

export type ReplayRunoutPresentation = {
  key: string;
  phase: ReplayRunoutPhase;
  visibleBoardCount: 0 | 3 | 4 | 5;
  /** Zero-based index of the verified Main/Side Pot being awarded. */
  potAwardIndex: number | null;
};

const SETTLEMENT_PAYOUT_PHASES: ReadonlySet<ReplayRunoutPhase> = new Set([
  "pot_collect",
  "pot_award",
  "dim",
  "glow",
  "summary_delay",
  "summary",
  "static",
]);

/** True after collection starts, including the final direct-jump/static state. */
export function isReplaySettlementPayoutPhase(phase: ReplayRunoutPhase | null | undefined): boolean {
  return phase != null && SETTLEMENT_PAYOUT_PHASES.has(phase);
}

const NEXT_PHASE: Record<Exclude<ReplayRunoutPhase, "static">, ReplayRunoutPhase> = {
  hole_hold: "flop",
  flop: "turn",
  turn: "river",
  river: "pot_collect",
  pot_collect: "pot_award",
  pot_award: "dim",
  dim: "glow",
  glow: "summary_delay",
  summary_delay: "summary",
  summary: "static",
};

function visibleBoardCount(phase: ReplayRunoutPhase): 0 | 3 | 4 | 5 {
  if (phase === "flop") return 3;
  if (phase === "turn") return 4;
  if (phase === "hole_hold") return 0;
  return 5;
}

export function createReplayRunoutPresentation(
  key: string,
  phase: ReplayRunoutPhase,
  potAwardIndex: number | null = null,
): ReplayRunoutPresentation {
  return { key, phase, visibleBoardCount: visibleBoardCount(phase), potAwardIndex };
}

export function nextReplayRunoutPhase(phase: ReplayRunoutPhase, potLayerCount = 0, potAwardIndex: number | null = null): ReplayRunoutPhase | null {
  if (phase === "static") return null;
  if (phase === "river" && potLayerCount <= 0) return "dim";
  if (phase === "pot_collect" && potLayerCount <= 0) return "dim";
  if (phase === "pot_award" && (potAwardIndex ?? 0) + 1 < potLayerCount) return "pot_award";
  if (phase === "pot_award" && potLayerCount > 0) return "static";
  return NEXT_PHASE[phase];
}

/** Advances the keyed UI-only payout timeline without changing replay data. */
export function nextReplayRunoutPresentation(
  presentation: ReplayRunoutPresentation,
  potLayerCount: number,
): ReplayRunoutPresentation | null {
  const nextPhase = nextReplayRunoutPhase(presentation.phase, potLayerCount, presentation.potAwardIndex);
  if (!nextPhase) return null;
  const nextPotAwardIndex = nextPhase === "pot_award"
    ? presentation.phase === "pot_award"
      ? (presentation.potAwardIndex ?? 0) + 1
      : 0
    : nextPhase === "static" && presentation.phase === "pot_award"
      ? presentation.potAwardIndex
    : null;
  return createReplayRunoutPresentation(presentation.key, nextPhase, nextPotAwardIndex);
}

export function replayRunoutPhaseDuration(phase: ReplayRunoutPhase, speed: number, shownPlayers = 0): number {
  // Money arrival and the reading hold stay readable even at fast action speed.
  if (phase === "pot_award") return POT_AWARD_MS;
  if (phase === "pot_collect") return POT_COLLECT_MS;
  const base = phase === "hole_hold"
    ? ALL_IN_HOLE_REVEAL_HOLD_MS
    : phase === "flop"
      ? FLOP_REVEAL_TOTAL_MS + FLOP_READ_HOLD_MS
      : phase === "turn"
        ? TURN_REVEAL_MS + TURN_READ_HOLD_MS
        : phase === "river"
          ? RIVER_REVEAL_MS + RIVER_RESULT_HOLD_MS
          : phase === "dim"
            ? BEST_FIVE_DIM_MS
            : phase === "glow"
              ? BEST_FIVE_GLOW_MS
              : phase === "summary_delay"
                ? SUMMARY_RANKING_DELAY_MS
                : phase === "summary"
                  ? RESULT_HOLD_MS
                  : 0;
  const safeSpeed = Math.max(0.5, Math.min(8, speed));
  const hold = phase === "hole_hold" && shownPlayers > 1
    ? showdownRevealDelay(shownPlayers - 1, 1) + ALL_IN_HOLE_REVEAL_HOLD_MS
    : base;
  return Math.round(hold / safeSpeed);
}

export function replayRunoutFocusPhase(phase: ReplayRunoutPhase | null): "hidden" | "dim" | "glow" | "static" {
  if (phase === "dim") return "dim";
  if (phase === "pot_award" || phase === "glow" || phase === "summary_delay" || phase === "summary") return "glow";
  return phase === "static" ? "static" : "hidden";
}

export function replayRunoutShowsSummary(phase: ReplayRunoutPhase | null): boolean {
  return phase === "pot_award" || phase === "summary" || phase === "static";
}
