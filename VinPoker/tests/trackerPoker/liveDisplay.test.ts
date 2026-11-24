import { describe, expect, it } from "vitest";
import { deriveLiveHandDisplay } from "@/lib/tracker-poker/liveDisplay";

describe("deriveLiveHandDisplay", () => {
  it.each([true,false])('keeps frozen BB ante out of uncalled refunds, live=%s',inProgress=>{
    const result=deriveLiveHandDisplay({startingStacks:new Map([['SB',1000],['BB',1000]]),
      inProgress,bigBlindAnteOnly:true,actions:[
        {player_id:'SB',action_type:'post_sb',action_amount:100},
        {player_id:'BB',action_type:'post_ante',action_amount:200},
        {player_id:'BB',action_type:'post_bb',action_amount:200},
        {player_id:'SB',action_type:'call',action_amount:100},
      ]});
    expect(result.potSize).toBe(600);
    expect(result.potBreakdown.uncalled).toBeNull();
    expect(result.potBreakdown.pots).toEqual([{amount:600,eligible_player_ids:['SB','BB']}]);
    expect(result.remainingStacks.get('BB')).toBe(600);
    expect(result.remainingStacks.get('SB')).toBe(800);
  });
  it("deducts BB then BB Ante immediately from the in-hand stack display", () => {
    const result = deriveLiveHandDisplay({
      startingStacks: new Map([["BB", 1_000], ["SB", 1_000]]),
      inProgress: true,
      actions: [
        { player_id: "SB", action_type: "post_sb", action_amount: 100 },
        { player_id: "BB", action_type: "post_bb", action_amount: 200 },
        { player_id: "BB", action_type: "post_ante", action_amount: 200 },
      ],
    });
    expect(result.remainingStacks.get("SB")).toBe(900);
    expect(result.remainingStacks.get("BB")).toBe(600);
    expect(result.potSize).toBe(500);
  });

  it("never displays a negative stack for a short all-in post stream", () => {
    const result = deriveLiveHandDisplay({
      startingStacks: new Map([["BB", 150], ["SB", 1_000]]),
      inProgress: true,
      actions: [
        { player_id: "BB", action_type: "post_bb", action_amount: 150 },
        { player_id: "BB", action_type: "post_ante", action_amount: 50 },
      ],
    });
    expect(result.remainingStacks.get("BB")).toBe(0);
  });

  it("uses distributable pot after uncalled refund for a completed hand", () => {
    const result = deriveLiveHandDisplay({
      startingStacks: new Map([["A", 1_000], ["B", 1_000]]),
      inProgress: false,
      actions: [
        { player_id: "A", action_type: "all_in", action_amount: 400 },
        { player_id: "B", action_type: "call", action_amount: 200 },
      ],
    });
    expect(result.potBreakdown.totalCommitted).toBe(600);
    expect(result.potBreakdown.uncalled).toEqual({ player_id: "A", amount: 200 });
    expect(result.potSize).toBe(400);
  });
});
