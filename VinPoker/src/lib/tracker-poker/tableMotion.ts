import type { ReplayFrame } from "./replayEngine";

export interface TableMotionPotAward {
  potIndex: number;
  amount: number;
  winnerSeatNumbers: number[];
}

interface TableMotionBase {
  id: string;
  handId: string;
}

export type TableMotionEvent =
  | (TableMotionBase & { kind: "deal_hole"; seatNumbers: number[] })
  | (TableMotionBase & { kind: "fold_muck"; seatNumber: number })
  | (TableMotionBase & { kind: "board_reveal"; street: string; cards: string[] })
  | (TableMotionBase & { kind: "showdown_reveal"; seatNumbers: number[] })
  | (TableMotionBase & { kind: "pot_award"; awards: TableMotionPotAward[] });

export function appendTableMotionEvents(
  current: TableMotionEvent[],
  incoming: TableMotionEvent[],
  max = 24,
): TableMotionEvent[] {
  if (incoming.length === 0) return current;
  const ids = new Set(current.map((event) => event.id));
  const next = [...current];
  for (const event of incoming) {
    if (!ids.has(event.id)) {
      ids.add(event.id);
      next.push(event);
    }
  }
  return next.slice(-max);
}

/**
 * Convert one verified replay-frame step into presentational motion events.
 * Navigation jumps and backward scrubs intentionally emit nothing.
 */
export function deriveReplayTableMotionEvents(args: {
  handId: string;
  previous: ReplayFrame | null;
  current: ReplayFrame;
}): TableMotionEvent[] {
  const { handId, previous, current } = args;
  if (current.index === 0) {
    const seatNumbers = current.seats.filter(seat => seat.is_active).map(seat => seat.seat_number);
    return seatNumbers.length < 2 ? [] : [{ id: `replay:${handId}:deal`, handId, kind: "deal_hole", seatNumbers }];
  }
  if (!previous || current.index <= previous.index || current.index - previous.index !== 1) return [];

  const prefix = `replay:${handId}:${current.index}`;
  const events: TableMotionEvent[] = [];

  const previousBoard = previous.displayCards.filter(Boolean).length;
  const currentCards = current.displayCards.filter(Boolean);
  if (currentCards.length > previousBoard) {
    events.push({
      id: `${prefix}:board:${currentCards.length}`,
      handId,
      kind: "board_reveal",
      street: current.currentStreet,
      cards: currentCards.slice(previousBoard),
    });
  }

  if (current.latestAction?.action_type === "fold" && current.latestAction.seat_number > 0) {
    events.push({
      id: `${prefix}:fold:${current.latestAction.action_id ?? current.latestAction.action_order}`,
      handId,
      kind: "fold_muck",
      seatNumber: current.latestAction.seat_number,
    });
  }

  if (!previous.revealHoleCards && current.revealHoleCards) {
    const seatNumbers = current.seats
      .filter((seat) => seat.hole_cards?.length === 2 && !seat.is_folded)
      .map((seat) => seat.seat_number);
    if (seatNumbers.length > 0) {
      events.push({ id: `${prefix}:showdown`, handId, kind: "showdown_reveal", seatNumbers });
    }
  }

  if (current.potAwards && current.potAwards.length > 0) {
    const seatByPlayer = new Map(current.seats.map((seat) => [seat.player_id, seat.seat_number]));
    const awards = current.potAwards
      .map((award) => ({
        potIndex: award.potIndex,
        amount: award.amount,
        winnerSeatNumbers: award.winnerPlayerIds
          .map((playerId) => seatByPlayer.get(playerId) ?? 0)
          .filter((seatNumber) => seatNumber > 0),
      }))
      .filter((award) => award.winnerSeatNumbers.length > 0);
    if (awards.length > 0) events.push({ id: `${prefix}:award`, handId, kind: "pot_award", awards });
  }

  return events;
}
