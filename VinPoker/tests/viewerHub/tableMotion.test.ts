import { describe, expect, it } from "vitest";
import type { ReplayFrame } from "@/lib/tracker-poker/replayEngine";
import {
  appendTableMotionEvents,
  deriveReplayTableMotionEvents,
  type TableMotionEvent,
} from "@/lib/tracker-poker/tableMotion";

const frame = (over: Partial<ReplayFrame>): ReplayFrame => ({
  index: 0,
  seats: [
    { player_id: "A", display_name: "A", seat_number: 1, chip_count: 0, is_active: true, table_id: null, position: "", hole_cards: ["Ah", "Kd"] },
    { player_id: "B", display_name: "B", seat_number: 2, chip_count: 0, is_active: true, table_id: null, position: "", hole_cards: ["Qs", "Qh"] },
  ],
  displayCards: ["", "", "", "", ""],
  potSize: 0,
  potBreakdown: null,
  currentStreet: "preflop",
  lastActorId: null,
  latestAction: null,
  revealHoleCards: false,
  ...over,
});

describe("deriveReplayTableMotionEvents", () => {
  it("emits all five VinPoker-native beats on verified single-step transitions", () => {
    const previous = frame({ index: 0 });
    const current = frame({
      index: 1,
      displayCards: ["As", "Kd", "Qc", "", ""],
      currentStreet: "flop",
      revealHoleCards: true,
      latestAction: {
        action_id: "action-1",
        street: "flop",
        player_id: "B",
        display_name: "B",
        seat_number: 2,
        action_type: "fold",
        action_amount: 0,
        action_order: 1,
      },
      potAwards: [{ potIndex: 0, amount: 2_000, winnerPlayerIds: ["A", "B"] }],
    });
    expect(deriveReplayTableMotionEvents({ handId: "h8", previous: null, current: previous }).map(event => event.kind)).toEqual(["deal_hole"]);
    expect(deriveReplayTableMotionEvents({ handId: "h8", previous, current }).map((event) => event.kind))
      .toEqual(["board_reveal", "fold_muck", "showdown_reveal", "pot_award"]);
  });

  it("emits nothing for backward scrub or multi-frame fast-forward", () => {
    expect(deriveReplayTableMotionEvents({ handId: "h", previous: frame({ index: 4 }), current: frame({ index: 3 }) })).toEqual([]);
    expect(deriveReplayTableMotionEvents({ handId: "h", previous: frame({ index: 1 }), current: frame({ index: 5 }) })).toEqual([]);
  });
});

describe("appendTableMotionEvents", () => {
  const event = (id: string): TableMotionEvent => ({ id, handId: "h", kind: "fold_muck", seatNumber: 1 });

  it("dedupes polling echoes and caps the retained queue", () => {
    const once = appendTableMotionEvents([], [event("a"), event("a")]);
    expect(once.map((item) => item.id)).toEqual(["a"]);
    const capped = appendTableMotionEvents(once, [event("b"), event("c"), event("d")], 3);
    expect(capped.map((item) => item.id)).toEqual(["b", "c", "d"]);
  });
});
