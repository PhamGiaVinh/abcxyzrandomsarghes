import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {ActionStepPanel} from './ActionStepPanel';
import {actorView,type FlowInput} from '@/lib/tracker-poker/handFlow';
import {reduceHand,type ActionRow,type PlayerSeed} from '@/lib/tracker-poker/handState';
import {validateAction} from '../../../../../supabase/functions/_shared/trackerEngine/validateAction.ts';

// TDA cumulative short-all-in oracle, identical stream for both operators.
// A last called100 and now faces200: +100 reopens. C last called125 and now
// faces200: +75 does not. This checks actual panel controls, not a mocked view.
const seeds:PlayerSeed[]=[['A',1,2000],['C',2,2000],['SHORT125',3,125],['SHORT200',4,200],['SB',5,2000],['BB',6,2000]]
 .map(([player_id,seat_number,starting_stack])=>({player_id:String(player_id),seat_number:Number(seat_number),starting_stack:Number(starting_stack)}));
const actions:ActionRow[]=[
 {player_id:'SB',street:'preflop',action_type:'post_sb',action_amount:50,action_order:1},
 {player_id:'BB',street:'preflop',action_type:'post_bb',action_amount:100,action_order:2},
 {player_id:'A',street:'preflop',action_type:'call',action_amount:100,action_order:3},
 {player_id:'SHORT125',street:'preflop',action_type:'all_in',action_amount:125,action_order:4},
 {player_id:'C',street:'preflop',action_type:'call',action_amount:125,action_order:5},
 {player_id:'SHORT200',street:'preflop',action_type:'all_in',action_amount:200,action_order:6},
];
afterEach(cleanup);
describe('actual Tracker action step cumulative short-all-in controls',()=>{
 it.each([{id:'A',reopened:true,toCall:100},{id:'C',reopened:false,toCall:75}])('$id preserves player-specific raise rights',({id,reopened,toCall})=>{
  const runtime=reduceHand(seeds,actions,1);
  const player=runtime.players.find(p=>p.player_id===id)!;
  const input:FlowInput={buttonSeat:1,bigBlind:100,currentStreet:'preflop',canonicalActions:actions,actedThisStreet:new Set(),
   players:runtime.players.map(p=>({player_id:p.player_id,seat_number:p.seat_number,starting_stack:p.starting_stack,
    current_stack:p.stack,current_bet:p.street_bet,is_folded:p.is_folded,is_all_in:p.is_all_in}))};
  const view=actorView(input,id),onAction=vi.fn();
  expect(view.toCall).toBe(toCall);expect(view.legal.raise).toBe(reopened);expect(view.legal.allIn).toBe(reopened);
  render(<ActionStepPanel actor={{player_id:id,seat_number:player.seat_number,display_name:`TEST ${id}`,current_stack:player.stack,current_bet:player.street_bet}}
   actorPosition="TEST" view={view} betAmount="300" onBetAmountChange={()=>{}} bigBlind={100}
   onAction={onAction} needsPostSB={false} needsPostBB={false} betIsTotal/>);
  const raise=screen.getByRole('button',{name:/^RAISE/}),allIn=screen.getByRole('button',{name:/^ALL-IN/});
  expect(raise).toHaveProperty('disabled',!reopened);expect(allIn).toHaveProperty('disabled',!reopened);
  fireEvent.click(raise);fireEvent.click(allIn);
  expect(onAction.mock.calls.map(([type])=>type)).toEqual(reopened?['raise','all_in']:[]);
  const server=validateAction(seeds,actions,1,{player_id:id,street:'preflop',action_type:'raise',action_amount:300-player.street_bet,action_order:7});
  expect(server).toMatchObject(reopened?{valid:true,code:'OK'}:{valid:false,code:'ACTION_NOT_REOPENED'});
  onAction.mockClear();fireEvent.click(screen.getByRole('button',{name:/^CALL/}));
  expect(onAction).toHaveBeenCalledWith('call');
  expect(validateAction(seeds,actions,1,{player_id:id,street:'preflop',action_type:'call',action_amount:toCall,action_order:7})).toMatchObject({valid:true,normalizedAmount:toCall});
  expect(runtime.players.reduce((sum,p)=>sum+p.stack+p.total_bet,0)).toBe(8325);
 });
});
