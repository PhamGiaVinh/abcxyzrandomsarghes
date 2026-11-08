import {render,screen,waitFor,fireEvent,cleanup,act} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {TournamentLiveView} from './TournamentLiveView';

const publicClock={is_running:false,remaining_seconds:null,current_level:null,small_blind:null,big_blind:null,big_blind_ante:null};
const {rpc,target,auth,signals,liveSignals,events,statuses}=vi.hoisted(()=>({
 statuses:[] as ((status:string)=>void)[],
 liveSignals:[] as AbortSignal[],events:[] as ((event?:unknown)=>void)[],signals:[] as AbortSignal[],rpc:vi.fn(),auth:{user:null,isStaffOps:false,isClubAdmin:false},
 target:{handId:'hand',tableId:'table',handNumber:32},
}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:(...args:unknown[])=>{const result=Promise.resolve(rpc(...args));return Object.assign(result,{abortSignal:(signal:AbortSignal)=>{(args[0]==='get_public_tournament_table_hand_v2'?signals:liveSignals).push(signal);return result;}});},channel:()=>{const c={on:(...args:unknown[])=>{const callback=args.at(-1);if(typeof callback==='function')events.push(callback as ()=>void);return c;},subscribe:(callback:(status:string)=>void)=>{statuses.push(callback);return c;}};return c},removeChannel:vi.fn()}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>auth}));
vi.mock('@/lib/publicTableTransport',()=>({readPublicTableRequest:async(_url:string,_key:string,tour:string,table:string,signal:AbortSignal,_send:typeof fetch,mode?:string)=>{
 liveSignals.push(signal);
 const result=await rpc('get_public_tournament_table_live_or_last_hand_v2',{p_tournament_id:tour,p_tournament_table_id:table});
 if(mode!=='table-clock'||result.error)return result;
 if(result.data?.access!=='public')return {data:{table:result.data,clock:[]},error:null};
 const clock=await rpc('get_public_tournament_clock_summary',{p_tournament_id:tour});
 return clock.error?clock:{data:{table:result.data,clock:clock.data},error:null};
}}));
vi.mock('@/components/tracker/useTournamentTableAppearance',()=>({useTournamentTableAppearance:()=>({data:undefined})}));
vi.mock('@/components/td-ai/TdAiAssistantPanel',()=>({TdAiAssistantPanel:()=>null}));
vi.mock('@/lib/tracker-poker/useTrackerRunoutSounds',()=>({useTrackerRunoutSounds:()=>{}}));
vi.mock('./LiveFelt',()=>({LiveFelt:({toActId}:{toActId?:string|null})=> <div data-testid="rendered-felt" data-actor={toActId??'none'}>Hand blinds unavailable</div>,formatStack:String,formatActionLabel:String}));

// Keep both HandSelector and ReplayScrubber real: the earlier parent tests
// deliberately mock child completion and cannot cover this async boundary.
beforeEach(()=>vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}}));
afterEach(()=>{cleanup();rpc.mockReset();signals.length=0;liveSignals.length=0;events.length=0;statuses.length=0;vi.unstubAllGlobals();});
it.each(['hand-first','settlement-first'] as const)('finishes exact replay across a table hint with %s responses',async(order)=>{
 let finishHand!:(value:unknown)=>void,finishSettlement!:(value:unknown)=>void;
 const heldHand=new Promise(resolve=>{finishHand=resolve;}),heldSettlement=new Promise(resolve=>{finishSettlement=resolve;});
 const payload={id:'hand',tableId:'table',handNumber:32,status:'completed',buttonSeat:1,board:[],pot:300,smallBlind:100,bigBlind:200,ante:0,
  players:[{playerId:'p1',seatNumber:1,name:'PLAYER1',startingStack:1000,endingStack:null,holeCards:[]},{playerId:'p2',seatNumber:2,name:'PLAYER2',startingStack:1000,endingStack:null,holeCards:[]}],
  actions:[{id:'sb',playerId:'p1',street:'preflop',actionType:'post_sb',amount:100,order:1},{id:'bb',playerId:'p2',street:'preflop',actionType:'post_bb',amount:200,order:2},{id:'fold',playerId:'p1',street:'preflop',actionType:'fold',amount:0,order:3}]};
 let handReads=0;
 rpc.mockImplementation((name:string)=>{
  if(name==='get_public_tournament_table_hand_v2'){handReads++;return handReads<=2?Promise.resolve({error:null,data:payload}):heldHand;}
  if(name==='get_public_tournament_settlement')return heldSettlement;
  if(name==='get_public_tournament_table_history_v2')return Promise.resolve({error:null,data:{access:'public',items:[],nextCursor:null}});
  if(name==='get_public_tournament_clock_summary')return Promise.resolve({error:null,data:[{...publicClock,tournament_id:'tour',players_remaining:2,average_stack:1000}]});
  if(name==='get_public_tournament_table_live_or_last_hand_v2')return Promise.resolve({error:null,data:{access:'public',state:'waiting',tableId:'table',tableSessionId:'session',hand:null}});
  return Promise.resolve({error:null,data:null});
 });
 render(<TournamentLiveView tournamentId="tour" spectator selectedTableIdOverride="table" initialReplayTarget={target}/>);
 await waitFor(()=>expect(rpc.mock.calls.some(([name])=>name==='get_public_tournament_settlement')).toBe(true));
 expect(screen.queryByTestId('replay-action-rail')).not.toBeInTheDocument();
 await act(async()=>{if(order==='hand-first')finishHand({error:null,data:payload});else finishSettlement({error:null,data:null});});
 await act(async()=>{events.forEach(fn=>fn({payload:{tournamentId:'tour',components:['tables']}}));});
 expect(screen.queryByTestId('replay-action-rail')).not.toBeInTheDocument();
 await act(async()=>{if(order==='hand-first')finishSettlement({error:null,data:null});else finishHand({error:null,data:payload});});
 const rail=await screen.findByTestId('replay-action-rail');expect(rail).toBeVisible();
 const slider=screen.getByRole('slider',{name:'Tua lại ván'});expect(slider).toHaveAttribute('aria-valuemax','3');
 fireEvent.click(screen.getByTitle('Tiến 1 bước',{exact:true}));await waitFor(()=>expect(slider).toHaveAttribute('aria-valuenow','1'));
});
