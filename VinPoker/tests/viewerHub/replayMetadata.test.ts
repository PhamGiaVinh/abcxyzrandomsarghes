import { describe, expect, it } from "vitest";
import { deriveReplayHeaderMetadata } from "@/components/cashier/tournament-live/viewer-hub/replayMetadata";
import type { ReplayHand } from "@/lib/tracker-poker/replayEngine";
import {buildReplayFrames} from '@/lib/tracker-poker/replayEngine';

const handOne: ReplayHand = {
  hand_id: "hand-1",
  hand_number: 1,
  button_seat: 1,
  community_cards: [],
  stored_pot_size: 300,
  players: Array.from({ length: 5 }, (_, index) => ({
    player_id: `player-${index}`,
    seat_number: index + 1,
    display_name: `Player ${index}`,
    starting_stack: 1000,
  })),
  actions: [],
};

const handEight: ReplayHand = {
  ...handOne,
  hand_id: "hand-8",
  hand_number: 8,
  stored_pot_size: 600,
  players: handOne.players.slice(0, 2),
  actions: Array.from({ length: 8 }, (_, index) => ({
    action_id: `action-${index}`,
    player_id: `player-${index % 2}`,
    street: "preflop",
    action_type: "call",
    action_amount: 100,
    action_order: index,
  })),
};

describe("deriveReplayHeaderMetadata", () => {
  it('uses the selected timeline pot including the final uncalled refund instead of stored gross contributions',()=>{
    const hand:ReplayHand={...handOne,players:handOne.players.slice(0,3),big_blind:200,small_blind:100,actions:[
      {player_id:'player-1',action_type:'post_sb',action_amount:100,street:'preflop',action_order:1},
      {player_id:'player-2',action_type:'post_bb',action_amount:200,street:'preflop',action_order:2},
      {player_id:'player-0',action_type:'fold',action_amount:0,street:'preflop',action_order:3},
      {player_id:'player-1',action_type:'fold',action_amount:0,street:'preflop',action_order:4},
    ]};
    const frames=buildReplayFrames(hand);
    expect(frames.map(f=>f.potSize)).toEqual([0,100,300,300,200]);
    expect(frames.map(f=>deriveReplayHeaderMetadata(hand,undefined,f).potSize)).toEqual([0,100,300,300,200]);
    expect(deriveReplayHeaderMetadata(hand,undefined,null).potSize).toBeNull();
  });
  it('retains only the resolved target identity while its snapshot is loading',()=>{
    expect(deriveReplayHeaderMetadata(null,{kind:'resolved',handId:'hand-8',tableId:'table',handNumber:8})).toEqual({
      handNumber:8,playerCount:null,averageStack:null,potSize:null,
    });
    expect(deriveReplayHeaderMetadata(null,{kind:'not_found'}).handNumber).toBeNull();
  });
  it("keeps header metadata tied to the selected hand snapshot", () => {
    expect(deriveReplayHeaderMetadata(handOne)).toMatchObject({
      handNumber: 1,
      playerCount: 5,
      averageStack: 1000,
      potSize: 300,
    });
    expect(deriveReplayHeaderMetadata(handEight)).toMatchObject({
      handNumber: 8,
      playerCount: 2,
      averageStack: 1000,
      potSize: 600,
    });
  });

  it("clears all replay metadata while the target is unresolved", () => {
    expect(deriveReplayHeaderMetadata(null)).toEqual({
      handNumber: null,
      playerCount: null,
      averageStack: null,
      potSize: null,
    });
  });
});
