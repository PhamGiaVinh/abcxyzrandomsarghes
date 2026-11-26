import { act, render } from "@testing-library/react";
import { orderedShowdownPlayers } from "@/lib/tracker-poker/replayRunoutTimeline";
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LiveFelt, type SeatInfo } from "@/components/cashier/tournament-live/LiveFelt";

const noBB = () => null;
function seat(over: Partial<SeatInfo>): SeatInfo {
  return {
    player_id: over.player_id ?? "p",
    display_name: over.display_name ?? "P",
    seat_number: over.seat_number ?? 1,
    chip_count: over.chip_count ?? 1000,
    is_active: true,
    table_id: "t",
    position: "",
    ...over,
  };
}
const baseProps = {
  lastActorId: null,
  toActId: null,
  displayCards: ["", "", "", "", ""],
  potSize: 0,
  potBreakdown: null,
  multiTableUnresolved: false,
  handNumber: 1,
  latestAction: null,
  formatBB: noBB,
};
// three showing seats
const shown = [
  seat({ player_id: "a", seat_number: 1, hole_cards: ["Kh", "3h"] }),
  seat({ player_id: "b", seat_number: 3, hole_cards: ["7s", "4s"] }),
  seat({ player_id: "c", seat_number: 5, hole_cards: ["As", "Ad"] }),
];

describe("LiveFelt showdown reveal", () => {
  it("keeps both opponents face down after call, then reveals the aggressor first", () => {
    vi.useFakeTimers();
    const players = shown.slice(0, 2);
    const actions = [
      { player_id: "a", action_type: "all_in", street: "preflop", action_order: 1 },
      { player_id: "b", action_type: "call", street: "preflop", action_order: 2 },
      { player_id: "system", action_type: "deal_flop", street: "flop", action_order: 3 },
    ];
    const order = orderedShowdownPlayers(players, actions, 1);
    const { container, unmount } = render(<LiveFelt seats={players} {...baseProps} revealOrder={order} />);
    const pockets = () => Array.from(container.querySelectorAll('[data-testid="seat-holecards"]'))
      .map(pocket => pocket.getAttribute("data-revealed"));
    try {
      expect(order).toEqual(["a", "b"]);
      expect(pockets()).toEqual(["false", "false"]);
      act(() => vi.advanceTimersByTime(349));
      expect(pockets()).toEqual(["false", "false"]);
      act(() => vi.advanceTimersByTime(1));
      expect(pockets()).toEqual(["true", "false"]);
      act(() => vi.advanceTimersByTime(500));
      expect(pockets()).toEqual(["true", "true"]);
    } finally {
      unmount();
      vi.useRealTimers();
    }
  });

  it("shows public cards immediately when viewing a static showdown", () => {
    const html = renderToStaticMarkup(<LiveFelt seats={shown} {...baseProps} />);
    expect(html.match(/data-revealed="true"/g)).toHaveLength(3);
  });
});
