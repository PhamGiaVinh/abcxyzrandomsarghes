import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { buildFixtureHand } from "@/dev/livefeltFixtures";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReplayHand } from "@/lib/tracker-poker/replayEngine";
import { ReplayScrubber } from "./ReplayScrubber";

const hand: ReplayHand = {
  hand_id: "hand-1",
  hand_number: 2,
  button_seat: 1,
  community_cards: [],
  big_blind: 200,
  players: [{ player_id: "player-1", seat_number: 3, display_name: "Player One", starting_stack: 40000 }],
  actions: [{ player_id: "player-1", street: "preflop", action_type: "post_sb", action_amount: 100, action_order: 1 }],
  publicSettlement: null,
  publicHistoryResult: { status: "verified", recipients: [{ playerId: "player-1", seatNumber: 3, name: "Player One", potAward: 200, netDelta: 100, potKinds: ["main"] }] },
};

beforeEach(() => vi.stubGlobal("ResizeObserver", class {
  observe() {}
  unobserve() {}
  disconnect() {}
}));
afterEach(() => vi.unstubAllGlobals());

it("plays SB, ante and BB before dealing two rounds to eight players", () => {
  vi.useFakeTimers();
  const onFrame = vi.fn();
  try {
    render(<ReplayScrubber hand={buildFixtureHand("verified-bba-jj", 8)} onFrame={onFrame} hud />);
    const current = () => onFrame.mock.calls.at(-1)?.[0];
    expect(current()).toMatchObject({ index: 0, holeCardsDealt: false, dealHoleCards: false });
    fireEvent.click(screen.getByTitle("Phát"));
    for (const actionType of ["post_sb", "post_ante", "post_bb"]) {
      act(() => vi.advanceTimersByTime(1000));
      expect(current().latestAction.action_type).toBe(actionType);
      expect(current().holeCardsDealt).toBe(false);
    }
    act(() => vi.advanceTimersByTime(350));
    expect(current()).toMatchObject({ index: 3, holeCardsDealt: true, dealHoleCards: true });
    act(() => vi.advanceTimersByTime(3499));
    expect(current().index).toBe(3);
    act(() => vi.advanceTimersByTime(1));
    expect(current()).toMatchObject({ index: 4, holeCardsDealt: true, dealHoleCards: false });
  } finally {
    cleanup();
    vi.useRealTimers();
  }
});

it("shows the exact verified History result only at the end without treating it as settlement proof", () => {
  render(<ReplayScrubber hand={hand} onFrame={vi.fn()} hud />);
  expect(screen.queryByTestId("replay-history-verified-result")).not.toBeInTheDocument();
  fireEvent.click(screen.getByTitle("Tới cuối (showdown)"));
  expect(screen.getByTestId("replay-history-verified-result")).toHaveTextContent("Player One");
  expect(screen.getByTestId("replay-history-verified-result")).toHaveTextContent("+100");
  expect(screen.queryByText("Chưa có kết quả — xem tab Hành động.")).not.toBeInTheDocument();
});

it("shows a verified full refund at the end without inventing a pot winner", () => {
  const refundHand: ReplayHand = { ...hand, publicHistoryResult: null, publicSettlement: {
    schemaVersion: "settlement-outcome-v1", status: "verified",
    players: [{ playerId: "player-1", potAward: 0, refund: 100, netDelta: 0 },
      { playerId: "player-2", potAward: 0, refund: 0, netDelta: 0 }],
    pots: [], refunds: [{ playerId: "player-1", amount: 100, sourceActionId: "bb-action" }], handRanks: [],
  } };
  render(<ReplayScrubber hand={refundHand} onFrame={vi.fn()} hud />);
  expect(screen.queryByTestId("replay-full-refund")).not.toBeInTheDocument();
  fireEvent.click(screen.getByTitle("Tới cuối (showdown)"));
  expect(screen.getByTestId("replay-full-refund")).toHaveTextContent("Player One");
  expect(screen.getByTestId("replay-full-refund")).toHaveTextContent("100");
  expect(screen.queryByText("Chưa có kết quả — xem tab Hành động.")).not.toBeInTheDocument();
  expect(screen.queryByText("Người thắng đã được xác minh")).not.toBeInTheDocument();
});
