import { describe, expect, it } from "vitest";
import { buildReplayFrames, type ReplayHand } from "@/lib/tracker-poker/replayEngine";

describe("recorded blind positions in the viewer", () => {
  it("does not turn the actual BB into SB when the small blind seat is dead", () => {
    const hand: ReplayHand = {
      hand_number: 2,
      button_seat: 2,
      community_cards: ["2c", "3d", "7h", "9s", "Tc"],
      players: [1, 2, 4, 5].map((seat) => ({
        player_id: `p${seat}`, seat_number: seat,
        display_name: `TEST ${seat}`, starting_stack: seat === 2 ? 40000 : 20000,
      })),
      actions: [
        { player_id: "p4", action_type: "post_bb", action_amount: 100, street: "preflop", action_order: 1 },
        { player_id: "p5", action_type: "all_in", action_amount: 20000, street: "preflop", action_order: 2 },
        { player_id: "p1", action_type: "fold", action_amount: 0, street: "preflop", action_order: 3 },
        { player_id: "p2", action_type: "fold", action_amount: 0, street: "preflop", action_order: 4 },
        { player_id: "p4", action_type: "call", action_amount: 19900, street: "preflop", action_order: 5 },
      ],
    };
    for (const frame of buildReplayFrames(hand)) {
      const positions = new Map(frame.seats.map((seat) => [seat.seat_number, seat.position]));
      expect(positions.get(4)).toBe("BB");
      expect(positions.get(2)).toBe("BTN");
      // With no frozen blind-slot metadata, don't invent the remaining labels.
      expect(positions.get(5)).toBe("");
      expect([...positions.values()]).not.toContain("SB");
    }
  });
});
