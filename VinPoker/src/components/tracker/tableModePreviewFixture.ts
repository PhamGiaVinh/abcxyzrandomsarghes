// Deterministic offline snapshots of one nine-handed table. No dealer or club identifiers.
import { computePotBreakdown } from "@/lib/tracker-poker/potEngine";
import { formatActionLabel, type ActionLog, type SeatInfo } from "@/components/cashier/tournament-live/LiveFelt";
import type { ActionIntent, SeatVM } from "./types";

export const STAGES = [
  { id: "preflop", label: "Preflop", boardCount: 0 },
  { id: "flop", label: "Flop", boardCount: 3 },
  { id: "turn", label: "Turn", boardCount: 4 },
  { id: "river", label: "River", boardCount: 5 },
  { id: "runout", label: "All-in", boardCount: 5 },
] as const;
export type Stage = typeof STAGES[number]["id"];
export const BLINDS = { sb: 500, bb: 1000, ante: 0, level: 4 };

const NAMES = ["Hà Linh", "Vũ Nam", "Minh Trí", "Hoàng An", "Nguyễn Hoàng Minh Anh", "Gia Hân", "Đức Anh", "Quang Huy", "Thu Giang"];
const STACKS = [35_000, 3_000, 30_000, 41_000, 48_000, 32_000, 29_000, 24_000, 31_000];
const POSITIONS = ["SB", "BB", "UTG", "UTG+1", "MP", "LJ", "HJ", "CO", "BTN"];
const BOARD = ["K♥", "10♣", "8♦", "4♠", "2♦"];
const ACTOR = 5;

export function previewHand(stage: Stage, intent: ActionIntent | null, allBets: boolean) {
  const preflop = stage === "preflop";
  const runout = stage === "runout";
  // Seats 2, 4 and 5 reached the flop. The short stack is all-in for 3,000.
  const lastAction: ActionLog | null = intent ? {
    player_id: "seat-" + intent.seatNumber,
    display_name: NAMES[intent.seatNumber - 1],
    seat_number: intent.seatNumber,
    action_type: intent.action,
    action_amount: intent.amount,
    action_order: 1,
    street: stage,
  } : null;
  const seats: SeatInfo[] = NAMES.map((name, index) => {
    const number = index + 1;
    // The allbets geometry fixture exercises seven-digit chip labels at each seat.
    const startingStack = allBets ? STACKS[index] * 1000 : STACKS[index];
    const inHand = [2, 4, 5].includes(number);
    const folded = !allBets && (preflop ? number === 3 : !inHand);
    const blind = number === 1 ? BLINDS.sb : number === 2 ? BLINDS.bb : 0;
    const prior = allBets || preflop ? 0 : number === 2 ? 3000 : inHand ? 5000 : blind;
    let committed = allBets ? 1_000_000 : preflop ? (number === 4 ? 2000 : blind) : number === 4 ? 2000 : 0;
    let total = prior + committed;
    if (runout && !allBets && (number === 4 || number === 5)) {
      total = STACKS[3];
      committed = 0;
    }
    const acted = intent?.seatNumber === number;
    if (acted && intent.amount > committed) {
      total += intent.amount - committed;
      committed = intent.amount;
    }
    return {
      player_id: "seat-" + number, display_name: name, seat_number: number,
      position: POSITIONS[index], table_id: "fixture-table", chip_count: startingStack - total,
      is_active: true, is_folded: folded || (acted && intent.action === "fold"),
      is_all_in: total === startingStack, current_bet: committed, display_committed_bet: committed,
      total_committed: total, last_action: acted && lastAction ? formatActionLabel(lastAction) : undefined,
    };
  });
  const breakdown = computePotBreakdown(seats.map((seat) => ({
    player_id: seat.player_id, total_bet: seat.total_committed ?? 0, is_folded: !!seat.is_folded,
  })));
  const dealerSeats: SeatVM[] = seats.map((seat) => ({
    playerId: seat.player_id, name: seat.display_name, position: seat.position, seatNumber: seat.seat_number,
    stack: seat.chip_count, committed: seat.current_bet, isFolded: seat.is_folded, isAllIn: seat.is_all_in,
    lastAction: seat.last_action,
  }));
  const count = STAGES.find((item) => item.id === stage)!.boardCount;
  const actor = runout || intent ? null : dealerSeats[ACTOR - 1];
  const toCall = actor ? Math.max(...dealerSeats.map((s) => s.committed ?? 0)) - (actor.committed ?? 0) : 0;
  return { seats, dealerSeats, breakdown, actor, toCall, lastAction,
    board: BOARD.map((card, index) => index < count ? card : "") };
}
