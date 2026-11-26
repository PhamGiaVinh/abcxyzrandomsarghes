import { describe, expect, it } from "vitest";
import { computeVoiceFinishSettlement } from "../../supabase/functions/_shared/trackerSettlement/finishAssist.ts";
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { reduceHand, isBettingRoundComplete } from '../../src/lib/tracker-poker/handStateCore';

const base = {
  handId: "hand-1",
  stateVersion: "a".repeat(64),
  buttonSeat: 1,
  players: [
    { player_id: "p1", entry_number: 1, seat_number: 1, starting_stack: 100, hole_cards: ["Ah", "Ad"], player_name: "A" },
    { player_id: "p2", entry_number: 1, seat_number: 2, starting_stack: 100, hole_cards: ["Kh", "Kd"], player_name: "B" },
  ],
};

describe("Voice Finish settlement", () => {
  it.each([false,true])('loads the ante rule and payer from persisted hand/participants: %s',async(frozenAnte)=>{
    const actions=[['p1','post_sb',100],['p2','post_ante',200],['p2','post_bb',200],['p1','call',100],['p2','check',0]]
      .map(([player_id,action_type,action_amount],index)=>({player_id:String(player_id),action_type:String(action_type),
        action_amount:Number(action_amount),entry_number:1,street:'preflop',action_order:index+1}));
    const players=base.players.map(player=>({...player,starting_stack:1000}));
    const stored={id:'hand-1',hand_number:1,created_at:'2026-11-24T00:00:00Z',button_seat:1,status:'in_progress',
      is_voided:false,community_cards:['2c','3d','7h','8s','9c'],tracker_big_blind_ante_only:frozenAnte,tracker_bb_position:2};
    const source=readFileSync('supabase/functions/tournament-live-update/index.ts','utf8');
    const parsed=ts.createSourceFile('edge.ts',source,ts.ScriptTarget.ES2022,true);
    const target=parsed.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='loadAuthoritativeVoiceFinish')!;
    const service={from:(table:string)=>{
      const response={error:null,data:table==='tournament_hands'?stored:table==='hand_players'?players:actions};
      const query={select:()=>query,eq:()=>query,order:()=>query,maybeSingle:async()=>response,
        then:(resolve: (value:unknown)=>unknown)=>Promise.resolve(response).then(resolve)};return query;
    }};
    const fn=runInNewContext(ts.transpileModule(target.getText(parsed)+'\nloadAuthoritativeVoiceFinish;',
      {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{
      Deno:{env:{get:()=> 'SYNTHETIC_LOCAL_ONLY'}},createClient:()=>service,reduceHand,isBettingRoundComplete,computeVoiceFinishSettlement,
    });
    const result=await fn({tournamentId:'tour',tournamentTableId:'table',handId:'hand-1',
      bigBlindAntePlayerId:'p1',snapshot:{players,actions,button_seat:1,state_version:base.stateVersion}});
    expect(result.settlement.potSize).toBe(frozenAnte?600:400);
    expect(result.settlement.recordPlayers.find((player:{player_id:string})=>player.player_id==='p2').ending_stack).toBe(frozenAnte?600:800);
  });
  it.each([200,100])('awards the frozen BB ante with matched wagers, ante=%s',async(ante)=>{
    const input={...base,players:base.players.map(player=>({...player,starting_stack:1000})),
      communityCards:['2c','3d','7h','8s','9c'],bettingComplete:true,
      actions:[['p1','post_sb',100],['p2','post_ante',ante],['p2','post_bb',200],['p1','call',100]]
        .map(([player_id,action_type,action_amount],index)=>({player_id:String(player_id),action_type:String(action_type),
          action_amount:Number(action_amount),entry_number:1,street:'preflop',action_order:index+1}))};
    const result=await computeVoiceFinishSettlement({...input,bigBlindAntePlayerId:'p2'});
    expect(result.potSize).toBe(400+ante);
    expect(result.summary.winners).toEqual([expect.objectContaining({player_id:'p1',amount:400+ante})]);
    expect(result.recordPlayers.find(player=>player.player_id==='p1')?.ending_stack).toBe(1200+ante);
    expect(result.recordPlayers.find(player=>player.player_id==='p2')?.ending_stack).toBe(800-ante);
    expect(result.summary.conservation_total).toBe(2000);
    const historical=await computeVoiceFinishSettlement(input);
    expect(historical.potSize).toBe(400);
    expect(historical.recordPlayers.find(player=>player.player_id==='p2')?.ending_stack).toBe(800);
  });
  it("uses the server evaluator for a complete showdown and produces a stable digest", async () => {
    const input = {
      ...base,
      communityCards: ["2c", "3d", "4h", "5s", "9c"],
      actions: [
        { player_id: "p1", entry_number: 1, street: "preflop", action_type: "post_sb", action_amount: 5, action_order: 1 },
        { player_id: "p2", entry_number: 1, street: "preflop", action_type: "post_bb", action_amount: 10, action_order: 2 },
        { player_id: "p1", entry_number: 1, street: "preflop", action_type: "call", action_amount: 5, action_order: 3 },
        { player_id: "p2", entry_number: 1, street: "flop", action_type: "bet", action_amount: 20, action_order: 4 },
        { player_id: "p1", entry_number: 1, street: "flop", action_type: "call", action_amount: 20, action_order: 5 },
      ],
      bettingComplete: true,
    };
    const [first, second] = await Promise.all([
      computeVoiceFinishSettlement(input),
      computeVoiceFinishSettlement(input),
    ]);
    expect(first.settlementOrigin).toBe("engine_showdown");
    expect(first.settlementDigest).toBe(second.settlementDigest);
    expect(first.summary.conservation_total).toBe(200);
    expect(first.recordPlayers.reduce((sum, player) => sum + player.ending_stack, 0)).toBe(200);
  });

  it("settles a verified fold win without requiring board or hole cards", async () => {
    const result = await computeVoiceFinishSettlement({
      ...base,
      players: base.players.map((player) => ({ ...player, hole_cards: [] })),
      communityCards: [],
      actions: [
        { player_id: "p1", entry_number: 1, street: "preflop", action_type: "post_sb", action_amount: 5, action_order: 1 },
        { player_id: "p2", entry_number: 1, street: "preflop", action_type: "post_bb", action_amount: 10, action_order: 2 },
        { player_id: "p1", entry_number: 1, street: "preflop", action_type: "fold", action_amount: 0, action_order: 3 },
      ],
      bettingComplete: true,
    });
    expect(result.settlementOrigin).toBe("engine_fold_win");
    expect(result.summary.winners).toEqual([expect.objectContaining({ player_id: "p2", amount: 10 })]);
    expect(result.summary.ending_stacks).toContainEqual(expect.objectContaining({ player_id: "p2", amount: 105 }));
  });

  it("fails closed when showdown evidence is incomplete or cards are duplicated", async () => {
    await expect(computeVoiceFinishSettlement({
      ...base,
      communityCards: ["2c", "3d", "4h", "5s"],
      actions: [
        { player_id: "p1", entry_number: 1, street: "preflop", action_type: "post_sb", action_amount: 5, action_order: 1 },
        { player_id: "p2", entry_number: 1, street: "preflop", action_type: "post_bb", action_amount: 10, action_order: 2 },
        { player_id: "p1", entry_number: 1, street: "preflop", action_type: "call", action_amount: 5, action_order: 3 },
      ],
      bettingComplete: true,
    })).rejects.toThrow("finish_requires_manual_showdown");
    await expect(computeVoiceFinishSettlement({
      ...base,
      communityCards: ["Ah", "3d", "4h", "5s", "9c"],
      actions: [
        { player_id: "p1", entry_number: 1, street: "preflop", action_type: "post_sb", action_amount: 5, action_order: 1 },
        { player_id: "p2", entry_number: 1, street: "preflop", action_type: "post_bb", action_amount: 10, action_order: 2 },
      ],
      bettingComplete: true,
    })).rejects.toThrow("finish_duplicate_card");
  });
});
