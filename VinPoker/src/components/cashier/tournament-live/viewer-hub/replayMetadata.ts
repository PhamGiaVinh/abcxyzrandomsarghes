import type { ReplayHand,ReplayFrame } from "@/lib/tracker-poker/replayEngine";
import type { ReplayTargetState } from './replayTarget';

export interface ReplayHeaderMetadata {
  handNumber: number | null;
  playerCount: number | null;
  averageStack: number | null;
  potSize: number | null;
}

/** Payload facts come only from the immutable snapshot; a resolved target can
 * supply its verified identity while that snapshot is still loading. When a
 * timeline is selected, its running/post-refund pot must match the felt. */
export function deriveReplayHeaderMetadata(hand: ReplayHand | null, target?: ReplayTargetState, frame?:ReplayFrame|null): ReplayHeaderMetadata {
  if (!hand) {
    return { handNumber: target?.kind === 'resolved' ? target.handNumber : null, playerCount: null, averageStack: null, potSize: null };
  }

  const stacks = hand.players
    .map((player) => player.starting_stack)
    .filter((stack) => Number.isFinite(stack));
  const storedPotSize = frame===undefined?hand.stored_pot_size:frame?.potSize;

  return {
    handNumber: hand.hand_number,
    playerCount: hand.players.length,
    averageStack: stacks.length > 0 ? Math.round(stacks.reduce((sum, stack) => sum + stack, 0) / stacks.length) : 0,
    potSize: typeof storedPotSize === "number" && Number.isFinite(storedPotSize) ? storedPotSize : null,
  };
}
