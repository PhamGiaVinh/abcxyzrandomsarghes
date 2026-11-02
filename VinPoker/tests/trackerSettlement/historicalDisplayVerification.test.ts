import { describe, expect, it } from "vitest";
import { settleShowdown } from '../../src/lib/tracker-poker/trackerShowdown';
import {validateSettlementOutcomeV1} from '../../supabase/functions/_shared/trackerSettlement/outcomeV1.ts';
import {parseReplayPublicSettlement} from '../../src/lib/tracker-poker/replaySettlement';
import {
  HistoricalDisplayVerificationError,
  verifyHistoricalDisplaySettlement,
} from "../../supabase/functions/_shared/trackerSettlement/historicalDisplayVerification.ts";

const sourceChainHash = "a".repeat(64);

function hand(overrides: Record<string, unknown> = {}) {
  return {
    id: "hand-8",
    tournament_id: "tournament-1",
    hand_number: 8,
    table_id: "table-1",
    button_seat: 2,
    community_cards: ["As", "Jd", "Qh", "Jh", "8h"],
    pot_size: 56_100_000,
    side_pots: [],
    status: "completed",
    is_voided: false,
    tracker_level_id: "level-1",
    tracker_level_number: 1,
    tracker_small_blind: 100,
    tracker_big_blind: 200,
    tracker_bba: 25,
    tracker_is_break: false,
    updated_at: "2026-07-12T00:00:00.000Z",
    created_at: "2026-07-12T00:00:00.000Z",
    ...overrides,
  };
}

function validInput() {
  return {
    tournamentId: "tournament-1",
    hand: hand(),
    players: [
      { hand_id: "hand-8", player_id: "limitless", entry_number: 1, seat_number: 2, starting_stack: 8_700_000, ending_stack: 8_700_000, hole_cards: ["Jc", "9d"], is_eliminated: false },
      { hand_id: "hand-8", player_id: "kayhan", entry_number: 1, seat_number: 3, starting_stack: 47_400_000, ending_stack: 47_400_000, hole_cards: ["Js", "Ts"], is_eliminated: false },
    ],
    actions: [
      { id: "h8-a1", hand_id: "hand-8", player_id: "limitless", entry_number: 1, street: "preflop", action_type: "call", action_amount: 8_700_000, action_order: 1 },
      { id: "h8-a2", hand_id: "hand-8", player_id: "kayhan", entry_number: 1, street: "preflop", action_type: "all_in", action_amount: 47_400_000, action_order: 2 },
    ],
    sourceRevision: 3,
    sourceChainHash,
    settlementRevision: 1,
  };
}

describe("historical display settlement verification", () => {
  function refundOnlyInput() {
    const input=validInput();
    input.hand=hand({community_cards:[],pot_size:0,tracker_small_blind:100,tracker_big_blind:100,tracker_bba:0});
    input.players=['A','B'].map((player_id,index)=>({hand_id:'hand-8',player_id,entry_number:1,seat_number:index+1,starting_stack:20000,ending_stack:20000,hole_cards:[],is_eliminated:false}));
    input.actions=[
      {id:'bb',hand_id:'hand-8',player_id:'B',entry_number:1,street:'preflop',action_type:'post_bb',action_amount:100,action_order:1},
      {id:'fold',hand_id:'hand-8',player_id:'A',entry_number:1,street:'preflop',action_type:'fold',action_amount:0,action_order:2},
    ];
    return input;
  }
  it('verifies a fully refunded dead-SB fold hand without inventing a pot or award',async()=>{
    const result=await verifyHistoricalDisplaySettlement(refundOnlyInput());
    expect(result.winnerIds).toEqual([]);
    expect(result.publicOutcome.pots).toEqual([]);
    expect(result.publicOutcome.refunds).toEqual([{playerId:'B',amount:100,sourceActionId:'bb'}]);
    expect(result.privateOutcome.totals).toMatchObject({committedTotal:100,distributablePot:0,refundTotal:100,potAward:0,netDelta:0,startingStack:40000,endingStack:40000});
    expect(validateSettlementOutcomeV1(result.privateOutcome).ok).toBe(true);
    const {schemaVersion,status,players,pots,refunds,handRanks}=result.publicOutcome;
    const publicProjection={schemaVersion,status,players,pots,refunds,handRanks};
    expect(parseReplayPublicSettlement(publicProjection)?.refunds).toEqual(result.publicOutcome.refunds);
    for(const mutate of [
      value=>{value.refunds=[];},
      value=>{value.players[0].netDelta=1;},
      value=>{value.players[0].potAward=1;},
      value=>{value.players[1].refund=99;},
    ]) {
      const privateValue=structuredClone(result.privateOutcome);mutate(privateValue);
      expect(validateSettlementOutcomeV1(privateValue).ok).toBe(false);
      const publicValue=structuredClone(publicProjection);mutate(publicValue);
      expect(parseReplayPublicSettlement(publicValue)).toBeNull();
    }
  });
  it.each(['no-actions','unfinished','wrong-stack'])('does not accept invalid refund-only evidence: %s',async mode=>{
    const input=refundOnlyInput();
    if(mode==='no-actions')input.actions=[];
    if(mode==='unfinished')input.actions=input.actions.slice(0,1);
    if(mode==='wrong-stack')input.players[1].ending_stack=19999;
    await expect(verifyHistoricalDisplaySettlement(input)).rejects.toBeInstanceOf(HistoricalDisplayVerificationError);
  });
  it.each([false,true])('agrees with Tracker on two side pots plus a separate refund (reverse rows=%s)',async(reverse)=>{
    const input=validInput();
    input.hand=hand({pot_size:100,button_seat:1,community_cards:['2c','4d','6h','8s','Tc']});
    const cards=[['As','Ad'],['Ks','Kd'],['Qs','Qd'],['Js','Jd']];
    input.players=[10,20,30,40].map((stack,i)=>({hand_id:'hand-8',player_id:`P${i+1}`,entry_number:1,
      seat_number:i+1,starting_stack:stack,ending_stack:40-i*10,hole_cards:cards[i],is_eliminated:false}));
    input.actions=input.players.map((p,i)=>({id:`multi-${i}`,hand_id:'hand-8',player_id:p.player_id,entry_number:1,
      street:'preflop',action_type:'all_in',action_amount:p.starting_stack,action_order:i+1}));
    if(reverse)input.players.reverse();
    const tracker=settleShowdown(input.players.map(p=>({player_id:p.player_id,seat_number:p.seat_number,
      starting_stack:p.starting_stack,stack:0,street_committed:p.starting_stack,total_committed:p.starting_stack,
      folded:false,all_in:true})),Object.fromEntries(input.players.map(p=>[p.player_id,p.hole_cards])),input.hand.community_cards);
    expect(tracker).not.toBeNull();
    expect(tracker!.layers.map(p=>[p.amount,p.winner_player_ids])).toEqual([[40,['P1']],[30,['P2']],[20,['P3']]]);
    expect(tracker!.uncalled).toEqual({player_id:'P4',amount:10});
    const verified=await verifyHistoricalDisplaySettlement(input);
    expect(verified.publicOutcome.pots.map(p=>[p.amount,p.winnerIds])).toEqual([[40,['P1']],[30,['P2']],[20,['P3']]]);
    const ends=Object.fromEntries(verified.publicOutcome.players.map(p=>[p.playerId,p.endingStack]));
    expect(ends).toEqual({P1:40,P2:30,P3:20,P4:10});
    expect(Object.fromEntries(tracker!.results.map(p=>[p.player_id,p.ending_stack]))).toEqual(ends);
    // Conservation alone cannot prove correctness: this shifted award still totals100.
    input.players.find(p=>p.player_id==='P1')!.ending_stack=41;
    input.players.find(p=>p.player_id==='P2')!.ending_stack=29;
    await expect(verifyHistoricalDisplaySettlement(input)).rejects.toThrow(/stored_ending_stack_mismatch/);
  });
  it('accepts a physical dead button and awards the odd chip clockwise after it',async()=>{
    const input=validInput();
    input.hand=hand({button_seat:1,community_cards:['2c','3d','4h','5s','9c'],pot_size:15});
    input.players=[
      {hand_id:'hand-8',player_id:'seat2',entry_number:1,seat_number:2,starting_stack:100,ending_stack:103,hole_cards:['As','Kd'],is_eliminated:false},
      {hand_id:'hand-8',player_id:'seat3',entry_number:1,seat_number:3,starting_stack:100,ending_stack:102,hole_cards:['Ah','Jd'],is_eliminated:false},
      {hand_id:'hand-8',player_id:'seat4',entry_number:1,seat_number:4,starting_stack:100,ending_stack:95,hole_cards:['Qs','Qc'],is_eliminated:false},
    ];
    input.actions=input.players.map((p,i)=>({id:`dead-${i}`,hand_id:'hand-8',player_id:p.player_id,entry_number:1,
      street:'preflop',action_type:'all_in',action_amount:5,action_order:i+1}));
    const result=await verifyHistoricalDisplaySettlement(input);
    expect(result.privateOutcome.privateEvidence.buttonSeat).toBe(1);
    expect(result.publicOutcome.pots[0].allocations).toEqual([
      {potId:'main-0',winnerId:'seat2',amount:8,includesOddChip:true},
      {potId:'main-0',winnerId:'seat3',amount:7,includesOddChip:false},
    ]);
  });
  it.each([0,11,1.5])('rejects an invalid physical button %s',async(button_seat)=>{
    const input=validInput();input.hand=hand({button_seat});
    await expect(verifyHistoricalDisplaySettlement(input)).rejects.toThrow(/INVALID_BUTTON_SEAT|invalid_historical_button/i);
  });
  it("awards an odd tied chip clockwise after the button and leaves the button last", async () => {
    const input = validInput();
    input.hand = hand({ button_seat: 2, community_cards: ["2c", "3d", "4h", "5s", "9c"], pot_size: 15 });
    input.players = [
      { hand_id: "hand-8", player_id: "button", entry_number: 1, seat_number: 2, starting_stack: 100, ending_stack: 102, hole_cards: ["As", "Kd"], is_eliminated: false },
      { hand_id: "hand-8", player_id: "left", entry_number: 1, seat_number: 3, starting_stack: 100, ending_stack: 103, hole_cards: ["Ah", "Jd"], is_eliminated: false },
      { hand_id: "hand-8", player_id: "loser", entry_number: 1, seat_number: 4, starting_stack: 100, ending_stack: 95, hole_cards: ["Qs", "Qc"], is_eliminated: false },
    ];
    input.actions = [
      { id: "odd-a1", hand_id: "hand-8", player_id: "button", entry_number: 1, street: "preflop", action_type: "all_in", action_amount: 5, action_order: 1 },
      { id: "odd-a2", hand_id: "hand-8", player_id: "left", entry_number: 1, street: "preflop", action_type: "all_in", action_amount: 5, action_order: 2 },
      { id: "odd-a3", hand_id: "hand-8", player_id: "loser", entry_number: 1, street: "preflop", action_type: "all_in", action_amount: 5, action_order: 3 },
    ];

    const result = await verifyHistoricalDisplaySettlement(input);
    expect(result.publicOutcome.pots[0].allocations).toEqual([
      { potId: "main-0", winnerId: "left", amount: 8, includesOddChip: true },
      { potId: "main-0", winnerId: "button", amount: 7, includesOddChip: false },
    ]);
  });

  it("awards an odd side-pot chip only among eligible tied winners", async () => {
    const input = validInput();
    input.hand = hand({ button_seat: 2, community_cards: ["2c", "3d", "4h", "5s", "9c"], pot_size: 7 });
    input.players = [
      { hand_id: "hand-8", player_id: "main", entry_number: 1, seat_number: 1, starting_stack: 1, ending_stack: 4, hole_cards: ["6s", "7s"], is_eliminated: false },
      { hand_id: "hand-8", player_id: "side-button", entry_number: 1, seat_number: 2, starting_stack: 2, ending_stack: 1, hole_cards: ["As", "Kd"], is_eliminated: false },
      { hand_id: "hand-8", player_id: "side-left", entry_number: 1, seat_number: 3, starting_stack: 2, ending_stack: 2, hole_cards: ["Ah", "Jd"], is_eliminated: false },
      { hand_id: "hand-8", player_id: "side-loser", entry_number: 1, seat_number: 4, starting_stack: 2, ending_stack: 0, hole_cards: ["Qs", "Qc"], is_eliminated: true },
    ];
    input.actions = input.players.map((player, index) => ({
      id: `side-odd-a${index + 1}`,
      hand_id: "hand-8",
      player_id: player.player_id,
      entry_number: 1,
      street: "preflop",
      action_type: "all_in",
      action_amount: player.starting_stack,
      action_order: index + 1,
    }));

    const result = await verifyHistoricalDisplaySettlement(input);
    expect(result.publicOutcome.pots[1]).toMatchObject({
      kind: "side",
      eligiblePlayerIds: ["side-button", "side-left", "side-loser"],
      allocations: [
        { potId: "side-1", winnerId: "side-left", amount: 2, includesOddChip: true },
        { potId: "side-1", winnerId: "side-button", amount: 1, includesOddChip: false },
      ],
    });
  });
  it("verifies a completed chop without reading or propagating later hands", async () => {
    const result = await verifyHistoricalDisplaySettlement(validInput());
    expect(result.winnerIds).toEqual(["kayhan", "limitless"]);
    expect(result.publicOutcome.pots[0].allocations).toEqual([
      { potId: "main-0", winnerId: "kayhan", amount: 8_700_000, includesOddChip: false },
      { potId: "main-0", winnerId: "limitless", amount: 8_700_000, includesOddChip: false },
    ]);
    expect(result.publicOutcome.refunds).toEqual([{ playerId: "kayhan", amount: 38_700_000, sourceActionId: "h8-a2" }]);
    expect(result.publicOutcome.handRanks.map((rank) => [rank.playerId, rank.category, rank.kickers, rank.bestFive.length])).toEqual([
      ["limitless", "trips", ["A", "Q"], 5],
      ["kayhan", "trips", ["A", "Q"], 5],
    ]);
    expect(result.publicOutcome).not.toHaveProperty("privateEvidence");
  });

  it("refuses the known Hand #8 stored-stack mismatch instead of showing a false chop", async () => {
    const input = validInput();
    input.players = input.players.map((player) => player.player_id === "limitless"
      ? { ...player, ending_stack: 17_400_000 }
      : { ...player, ending_stack: 38_700_000 });
    await expect(verifyHistoricalDisplaySettlement(input)).rejects.toMatchObject<Partial<HistoricalDisplayVerificationError>>({
      code: "stored_ending_stack_mismatch",
    });
  });

  it("requires complete showdown evidence and rejects malformed player/action identities", async () => {
    const noCards = validInput();
    noCards.players = noCards.players.map((player) => ({ ...player, hole_cards: [] }));
    await expect(verifyHistoricalDisplaySettlement(noCards)).rejects.toMatchObject<Partial<HistoricalDisplayVerificationError>>({
      code: "incomplete_showdown_cards",
    });

    const duplicate = validInput();
    duplicate.players = [...duplicate.players, { ...duplicate.players[0], seat_number: 4 }];
    await expect(verifyHistoricalDisplaySettlement(duplicate)).rejects.toMatchObject<Partial<HistoricalDisplayVerificationError>>({
      code: "duplicate_historical_player",
    });

    const mismatchedAction = validInput();
    mismatchedAction.actions = mismatchedAction.actions.map((action) => ({ ...action, entry_number: 2 }));
    await expect(verifyHistoricalDisplaySettlement(mismatchedAction)).rejects.toMatchObject<Partial<HistoricalDisplayVerificationError>>({
      code: "historical_action_identity_mismatch",
    });
  });

  it("keeps a fold win verified without inventing showdown ranks", async () => {
    const input = validInput();
    input.hand = hand({ community_cards: [], pot_size: 200, tracker_big_blind: 100 });
    input.players = [
      { hand_id: "hand-8", player_id: "A", entry_number: 1, seat_number: 1, starting_stack: 1_000, ending_stack: 1_100, hole_cards: [], is_eliminated: false },
      { hand_id: "hand-8", player_id: "B", entry_number: 1, seat_number: 2, starting_stack: 1_000, ending_stack: 900, hole_cards: [], is_eliminated: false },
    ];
    input.actions = [
      { id: "fold-a1", hand_id: "hand-8", player_id: "A", entry_number: 1, street: "preflop", action_type: "bet", action_amount: 100, action_order: 1 },
      { id: "fold-a2", hand_id: "hand-8", player_id: "B", entry_number: 1, street: "preflop", action_type: "post_bb", action_amount: 100, action_order: 2 },
      { id: "fold-a3", hand_id: "hand-8", player_id: "B", entry_number: 1, street: "preflop", action_type: "fold", action_amount: 0, action_order: 3 },
    ];
    const result = await verifyHistoricalDisplaySettlement(input);
    expect(result.winnerIds).toEqual(["A"]);
    expect(result.publicOutcome.handRanks).toEqual([]);
  });

  it.each(["post_bb", "big_blind"])("traces an uncalled %s refund after an SB fold", async (blindType) => {
    const input = validInput();
    input.hand = hand({ community_cards: [], pot_size: 200, tracker_bba: 0 });
    input.players = [
      { hand_id: "hand-8", player_id: "SB", entry_number: 1, seat_number: 1, starting_stack: 20_000, ending_stack: 19_900, hole_cards: [], is_eliminated: false },
      { hand_id: "hand-8", player_id: "BB", entry_number: 1, seat_number: 2, starting_stack: 20_000, ending_stack: 20_100, hole_cards: [], is_eliminated: false },
    ];
    input.actions = [
      { id: "sb", hand_id: "hand-8", player_id: "SB", entry_number: 1, street: "preflop", action_type: "post_sb", action_amount: 100, action_order: 1 },
      { id: "bb", hand_id: "hand-8", player_id: "BB", entry_number: 1, street: "preflop", action_type: blindType, action_amount: 200, action_order: 2 },
      { id: "fold", hand_id: "hand-8", player_id: "SB", entry_number: 1, street: "preflop", action_type: "fold", action_amount: 0, action_order: 3 },
    ];
    const result = await verifyHistoricalDisplaySettlement(input);
    expect(result.winnerIds).toEqual(["BB"]);
    expect(result.publicOutcome.refunds).toEqual([{ playerId: "BB", amount: 100, sourceActionId: "bb" }]);
    expect(result.publicOutcome.handRanks).toEqual([]);
  });

  it("requires a frozen blind snapshot and never infers from posts", async () => {
    const input = validInput();
    input.hand = hand({ tracker_big_blind: null, tracker_small_blind: null, tracker_level_id: null });
    await expect(verifyHistoricalDisplaySettlement(input)).rejects.toMatchObject<Partial<HistoricalDisplayVerificationError>>({
      code: "historical_blind_snapshot_missing",
    });
  });

  it.each([{ tracker_small_blind: 0 }, { tracker_big_blind: 99 }, { tracker_bba: -1 }])("rejects invalid blind evidence %j", async (invalid) => {
    const input = validInput();
    input.hand = hand(invalid);
    await expect(verifyHistoricalDisplaySettlement(input)).rejects.toMatchObject({ code: "historical_blind_snapshot_missing" });
  });

  it("keeps Hand #9's frozen 200k BB and advances corrected display revisions", async () => {
    const input = validInput();
    input.hand = hand({
      id: "hand-9", hand_number: 9, button_seat: 2,
      community_cards: ["2c", "7d", "9h", "3s", "Kc"], pot_size: 4_800_000,
      tracker_level_id: "level-9", tracker_level_number: 3,
      tracker_small_blind: 100_000, tracker_big_blind: 200_000, tracker_bba: 25_000,
    });
    input.players = [
      { hand_id: "hand-9", player_id: "winner", entry_number: 1, seat_number: 1, starting_stack: 5_000_000, ending_stack: 7_400_000, hole_cards: ["As", "Ad"], is_eliminated: false },
      { hand_id: "hand-9", player_id: "loser", entry_number: 1, seat_number: 2, starting_stack: 5_000_000, ending_stack: 2_600_000, hole_cards: ["Qs", "Qd"], is_eliminated: false },
    ];
    input.actions = [
      { id: "h9-a1", hand_id: "hand-9", player_id: "winner", entry_number: 1, street: "preflop", action_type: "post_sb", action_amount: 100_000, action_order: 1 },
      { id: "h9-a2", hand_id: "hand-9", player_id: "winner", entry_number: 1, street: "preflop", action_type: "post_ante", action_amount: 25_000, action_order: 2 },
      { id: "h9-a3", hand_id: "hand-9", player_id: "loser", entry_number: 1, street: "preflop", action_type: "post_bb", action_amount: 200_000, action_order: 3 },
      { id: "h9-a4", hand_id: "hand-9", player_id: "loser", entry_number: 1, street: "preflop", action_type: "post_ante", action_amount: 25_000, action_order: 4 },
      { id: "h9-a5", hand_id: "hand-9", player_id: "winner", entry_number: 1, street: "preflop", action_type: "all_in", action_amount: 2_275_000, action_order: 5 },
      { id: "h9-a6", hand_id: "hand-9", player_id: "loser", entry_number: 1, street: "preflop", action_type: "call", action_amount: 2_175_000, action_order: 6 },
    ];
    input.settlementRevision = 2;
    const result = await verifyHistoricalDisplaySettlement(input);
    expect(result.publicOutcome.players.find((player) => player.playerId === "winner")?.netDelta).toBe(2_400_000);
    expect(result.privateOutcome.settlementRevision).toBe(2);
  });

  it("accepts legacy forced-bet labels without changing the stored action evidence", async () => {
    const input = validInput();
    input.hand = hand({
      id: "legacy-hand",
      hand_number: 4,
      button_seat: 1,
      community_cards: [],
      pot_size: 60_000,
    });
    input.players = [
      { hand_id: "legacy-hand", player_id: "A", entry_number: 1, seat_number: 1, starting_stack: 30_000, ending_stack: 60_000, hole_cards: [], is_eliminated: false },
      { hand_id: "legacy-hand", player_id: "B", entry_number: 1, seat_number: 2, starting_stack: 30_000, ending_stack: 0, hole_cards: [], is_eliminated: true },
    ];
    input.actions = [
      { id: "legacy-a1", hand_id: "legacy-hand", player_id: "B", entry_number: 1, street: "preflop", action_type: "small_blind", action_amount: 100, action_order: 1 },
      { id: "legacy-a2", hand_id: "legacy-hand", player_id: "A", entry_number: 1, street: "preflop", action_type: "big_blind", action_amount: 200, action_order: 2 },
      { id: "legacy-a3", hand_id: "legacy-hand", player_id: "B", entry_number: 1, street: "preflop", action_type: "all_in", action_amount: 29_900, action_order: 3 },
      { id: "legacy-a4", hand_id: "legacy-hand", player_id: "A", entry_number: 1, street: "preflop", action_type: "call", action_amount: 29_800, action_order: 4 },
      { id: "legacy-a5", hand_id: "legacy-hand", player_id: "B", entry_number: 1, street: "showdown", action_type: "fold", action_amount: 0, action_order: 5 },
    ];

    const result = await verifyHistoricalDisplaySettlement(input);
    expect(result.winnerIds).toEqual(["A"]);
    expect(result.publicOutcome.players.find((player) => player.playerId === "A")?.potAward).toBe(60_000);
    expect(result.privateOutcome.privateEvidence?.actions.map((action) => action.actionType)).toEqual([
      "small_blind", "big_blind", "all_in", "call", "fold",
    ]);
  });

  it("allocates main and side pots while keeping each showdown ranking unique", async () => {
    const input = validInput();
    input.hand = hand({ id: "side-pot-hand", hand_number: 9, pot_size: 50, button_seat: 1, community_cards: ["2c", "7d", "9h", "3s", "Kc"] });
    input.players = [
      { hand_id: "side-pot-hand", player_id: "A", entry_number: 1, seat_number: 1, starting_stack: 10, ending_stack: 30, hole_cards: ["As", "Ad"], is_eliminated: false },
      { hand_id: "side-pot-hand", player_id: "B", entry_number: 1, seat_number: 2, starting_stack: 20, ending_stack: 20, hole_cards: ["Qs", "Qd"], is_eliminated: false },
      { hand_id: "side-pot-hand", player_id: "C", entry_number: 1, seat_number: 3, starting_stack: 20, ending_stack: 0, hole_cards: ["Js", "Jd"], is_eliminated: true },
    ];
    input.actions = [
      { id: "side-a1", hand_id: "side-pot-hand", player_id: "A", entry_number: 1, street: "preflop", action_type: "all_in", action_amount: 10, action_order: 1 },
      { id: "side-a2", hand_id: "side-pot-hand", player_id: "B", entry_number: 1, street: "preflop", action_type: "all_in", action_amount: 20, action_order: 2 },
      { id: "side-a3", hand_id: "side-pot-hand", player_id: "C", entry_number: 1, street: "preflop", action_type: "call", action_amount: 20, action_order: 3 },
    ];

    const result = await verifyHistoricalDisplaySettlement(input);
    expect(result.publicOutcome.pots.map((pot) => [pot.kind, pot.amount, pot.winnerIds])).toEqual([
      ["main", 30, ["A"]],
      ["side", 20, ["B"]],
    ]);
    expect(result.publicOutcome.handRanks.map((rank) => rank.playerId).sort()).toEqual(["A", "B"]);
  });
});
