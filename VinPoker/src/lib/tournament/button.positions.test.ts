import { describe, expect, it } from "vitest";
import { getBlindSlotSeatPositions, getHandSeatPositions, getSeatPositions } from "./button";

const players = (seats: number[]) => seats.map((seat_number) => ({ player_id: `p${seat_number}`, seat_number }));
const post = (seat: number, action_type: string) => ({ player_id: `p${seat}`, action_type });

describe('operator positions with known blind slots', () => {
  it('keeps UTG immediately after actual BB with a dead SB (Final hand9)', () => {
    expect(getBlindSlotSeatPositions([4,5,6,7,8,9],9,null,4))
      .toEqual(new Map([[4,'BB'],[5,'UTG'],[6,'LJ'],[7,'HJ'],[8,'CO'],[9,'BTN']]));
  });
  it('does not assign an empty button or dead SB to a live player (Final hand10)', () => {
    expect(getBlindSlotSeatPositions([5,6,7,8,9],3,null,5))
      .toEqual(new Map([[5,'BB'],[6,'UTG'],[7,'LJ'],[8,'HJ'],[9,'CO']]));
  });
  it.each([
    {seats:[1,3,5,7],btn:1,sb:3,bb:5},
    {seats:[1,2,3,4,5,6],btn:4,sb:5,bb:6},
    {seats:[2,9],btn:9,sb:9,bb:2},
  ])('preserves existing normal/HU convention $seats', ({seats,btn,sb,bb}) => {
    expect(getBlindSlotSeatPositions(seats,btn,sb,bb)).toEqual(getSeatPositions(seats,btn));
  });
});

describe("display positions use recorded blind posts", () => {
  it.each([
    { seats: [1, 3, 5, 7], btn: 1, sb: 3, bb: 5 },
    { seats: [2, 9], btn: 9, sb: 9, bb: 2 },
  ])("preserves normal ring and heads-up labels ($seats)", ({ seats, btn, sb, bb }) => {
    expect(getHandSeatPositions(players(seats), btn, [post(sb, "post_sb"), post(bb, "post_bb")]))
      .toEqual(getSeatPositions(seats, btn));
  });

  it("retains legacy position display when there are no recorded blind posts", () => {
    expect(getHandSeatPositions(players([2, 5, 9]), 2, [post(5, "fold")]))
      .toEqual(getSeatPositions([2, 5, 9], 2));
  });

  it("does not move a dead button onto a live player", () => {
    expect(getHandSeatPositions(players([1, 3, 4]), 2, [post(3, "post_sb"), post(4, "post_bb")]))
      .toEqual(new Map([[1, ""], [3, "SB"], [4, "BB"]]));
  });

  it("does not mutate source players or actions", () => {
    const roster = players([1, 2, 4, 5]);
    const actions = [post(4, "post_bb"), post(5, "all_in")];
    const before = JSON.stringify({ roster, actions });
    getHandSeatPositions(roster, 2, actions);
    expect(JSON.stringify({ roster, actions })).toBe(before);
  });
});
