import {render,screen,waitFor,fireEvent,cleanup,act} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {TournamentLiveView} from './TournamentLiveView';

const {rpc,hand,target,auth,signals,liveSignals,events,statuses}=vi.hoisted(()=>({
 statuses:[] as ((status:string)=>void)[],
 liveSignals:[] as AbortSignal[],events:[] as ((event?:unknown)=>void)[],signals:[] as AbortSignal[],rpc:vi.fn(),auth:{user:null,isStaffOps:false,isClubAdmin:false},
 target:{handId:'hand',tableId:'table',handNumber:32},
 hand:{hand_id:'hand',hand_number:32,button_seat:2,community_cards:['2c','3d','7s','9c','Kc'],big_blind:200,small_blind:100,ante:0,players:[],actions:[]},
}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:(...args:unknown[])=>{const result=Promise.resolve(rpc(...args));return Object.assign(result,{abortSignal:(signal:AbortSignal)=>{(args[0]==='get_public_tournament_table_hand_v2'?signals:liveSignals).push(signal);return result;}});},channel:()=>{const c={on:(...args:unknown[])=>{const callback=args.at(-1);if(typeof callback==='function')events.push(callback as ()=>void);return c;},subscribe:(callback:(status:string)=>void)=>{statuses.push(callback);return c;}};return c},removeChannel:vi.fn()}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>auth}));
vi.mock('@/components/tracker/useTournamentTableAppearance',()=>({useTournamentTableAppearance:()=>({data:undefined})}));
vi.mock('@/components/td-ai/TdAiAssistantPanel',()=>({TdAiAssistantPanel:()=>null}));
vi.mock('@/lib/tracker-poker/useTrackerRunoutSounds',()=>({useTrackerRunoutSounds:()=>{}}));
vi.mock('./LiveFelt',()=>({LiveFelt:({toActId}:{toActId?:string|null})=> <div data-testid="rendered-felt" data-actor={toActId??'none'}>Hand blinds unavailable</div>,formatStack:String,formatActionLabel:String}));
// Exercise the real parent read/presentation boundary; child completion is held
// explicitly rather than claiming this unit test is browser/DB acceptance.
vi.mock('./HandSelector',()=>({HandSelector:({onSelectHand,replayTargetState,onRetryReplayTarget}:{onSelectHand:(id:string,h:unknown)=>void;replayTargetState:{kind:string};onRetryReplayTarget?:()=>void})=><><p data-testid="target-state">{replayTargetState.kind}</p>{replayTargetState.kind==='query_error'&&<button onClick={onRetryReplayTarget}>Thử tìm lại hand</button>}<button onClick={()=>onSelectHand('hand',hand)}>Deliver replay</button></>}));
vi.mock('./ReplayScrubber',()=>({ReplayScrubber:()=>null}));
afterEach(async()=>{cleanup();await Promise.resolve();rpc.mockReset();signals.length=0;liveSignals.length=0;events.length=0;statuses.length=0;vi.useRealTimers()});

it.each([false,true])('does not spotlight an actor after a fold has ended betting: folded=%s',async(folded)=>{
 const players=[{playerId:'p1',seatNumber:1,entryNumber:1,name:'PLAYER1',startingStack:58800,endingStack:null,holeCards:[],eliminated:false,avatarUrl:null},
  {playerId:'p2',seatNumber:2,entryNumber:1,name:'PLAYER2',startingStack:1200,endingStack:null,holeCards:[],eliminated:false,avatarUrl:null}];
 const actions=[{id:'sb',playerId:'p2',entryNumber:1,order:1,amount:100,street:'preflop',actionType:'post_sb'},
  {id:'bb',playerId:'p1',entryNumber:1,order:2,amount:200,street:'preflop',actionType:'post_bb'},
  ...(folded?[{id:'fold',playerId:'p2',entryNumber:1,order:3,amount:0,street:'preflop',actionType:'fold'}]:[])];
 rpc.mockImplementation(async(name:string)=>({error:null,data:
  name==='get_public_tournament_clock_summary'?[{tournament_id:'tour',players_remaining:2,average_stack:30000}]:
  name==='get_public_tournament_table_live_or_last_hand_v2'?{access:'public',state:'live',tableId:'table',tableSessionId:'session',hand:{
   id:'live-hand',tournamentId:'tour',tableId:'table',tableSessionId:'session',handNumber:38,status:'in_progress',buttonSeat:2,
   board:[],pot:0,smallBlind:100,bigBlind:200,ante:0,levelNumber:1,players,actions,holeCardsPolicy:'recorded'}}:null}));
 render(<TournamentLiveView tournamentId="tour" spectator selectedTableIdOverride="table"/>);
 await waitFor(()=>expect(screen.getByTestId('rendered-felt')).toHaveAttribute('data-actor',folded?'none':'p2'));
});

it('shows a recoverable initial read failure when the transport rejects',async()=>{
 rpc.mockRejectedValue(new Error('TEST live transport offline'));
 render(<TournamentLiveView tournamentId="tour" spectator selectedTableIdOverride="table"/>);
 expect(await screen.findByText('Không tải được dữ liệu live tracker')).toBeInTheDocument();
 expect(screen.getByText('TEST live transport offline')).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Thử lại'})).toBeInTheDocument();
 expect(screen.queryByTestId('rendered-felt')).not.toBeInTheDocument();
 rpc.mockImplementation(async(name:string)=>({error:null,data:
  name==='get_public_tournament_clock_summary'?[{tournament_id:'tour',players_remaining:0,average_stack:0}]:
  name==='get_public_tournament_table_live_or_last_hand_v2'?{access:'public',state:'waiting',tableId:'table',tableSessionId:'session',hand:null}:null}));
 fireEvent.click(screen.getByRole('button',{name:'Thử lại'}));
 await waitFor(()=>expect(screen.queryByText('TEST live transport offline')).not.toBeInTheDocument());
 // The recovered server state is waiting with no hand, not a populated felt.
 await screen.findByText('Waiting...');
 expect(screen.queryByText('Không tải được dữ liệu live tracker')).not.toBeInTheDocument();
});

it('does not present an empty live felt while the selected replay payload is pending',async()=>{
 rpc.mockImplementation(async(name:string)=>({error:null,data:
  name==='get_public_tournament_clock_summary'?[{tournament_id:'tour',players_remaining:0,average_stack:0}]:
  name==='get_public_tournament_table_live_or_last_hand_v2'?{access:'public',state:'waiting',tableId:'table',tableSessionId:'session',hand:null}:
  name==='get_public_tournament_table_hand_v2'?{id:'hand',tableId:'table',handNumber:32,status:'completed'}:null}));
 render(<TournamentLiveView tournamentId="tour" spectator selectedTableIdOverride="table" initialReplayTarget={target}/>);
 await screen.findByRole('button',{name:'Deliver replay'});
 expect(screen.queryByTestId('rendered-felt')).not.toBeInTheDocument();
 expect(screen.getByText('Replay chưa sẵn sàng')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Deliver replay'}));
 await waitFor(()=>expect(screen.getByTestId('rendered-felt')).toBeInTheDocument());
 expect(screen.queryByText('Replay chưa sẵn sàng')).not.toBeInTheDocument();
});

it('bounds a hung replay target, rejects its late result, and retries the same target explicitly',async()=>{
 let resolve!:(value:unknown)=>void;const held=new Promise(done=>{resolve=done;});let hold=true;
 rpc.mockImplementation((name:string)=>name==='get_public_tournament_table_hand_v2'&&hold?held:Promise.resolve({error:null,data:
 name==='get_public_tournament_clock_summary'?[{tournament_id:'tour',players_remaining:0,average_stack:0}]:
 name==='get_public_tournament_table_live_or_last_hand_v2'?{access:'public',state:'waiting',tableId:'table',tableSessionId:'session',hand:null}:
 name==='get_public_tournament_table_hand_v2'?{id:'hand',tableId:'table',handNumber:32,status:'completed'}:null}));
 vi.useFakeTimers();render(<TournamentLiveView tournamentId="tour" spectator selectedTableIdOverride="table" initialReplayTarget={target}/>);
 await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});
 expect(screen.getByTestId('target-state')).toHaveTextContent('query_error');
 expect(signals).toHaveLength(1);expect(signals[0].aborted).toBe(true);
 expect(screen.queryByTestId('rendered-felt')).not.toBeInTheDocument();
 await act(async()=>{resolve({data:{id:'hand',tableId:'table',handNumber:32,status:'completed'},error:null});});
 expect(screen.getByTestId('target-state')).toHaveTextContent('query_error');hold=false;
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Thử tìm lại hand'}));});
 expect(screen.getByTestId('target-state')).toHaveTextContent('resolved');
 expect(rpc.mock.calls.filter(([name])=>name==='get_public_tournament_table_hand_v2')).toHaveLength(2);
});
it('turns a rejected replay target read into a recoverable query error',async()=>{
 rpc.mockImplementation((name:string)=>name==='get_public_tournament_table_hand_v2'?Promise.reject(new Error('offline target')):Promise.resolve({error:null,data:name==='get_public_tournament_clock_summary'?[{tournament_id:'tour',players_remaining:0,average_stack:0}]:name==='get_public_tournament_table_live_or_last_hand_v2'?{access:'public',state:'waiting',tableId:'table',tableSessionId:'session',hand:null}:null}));
 render(<TournamentLiveView tournamentId="tour" spectator selectedTableIdOverride="table" initialReplayTarget={target}/>);
 await waitFor(()=>expect(screen.getByTestId('target-state')).toHaveTextContent('query_error'));
 expect(screen.getByRole('button',{name:'Thử tìm lại hand'})).toBeInTheDocument();
 expect(screen.queryByTestId('rendered-felt')).not.toBeInTheDocument();expect(signals[0].aborted).toBe(true);
});
it('aborts an owned replay target read when its viewer unmounts',async()=>{
 rpc.mockImplementation(()=>new Promise(()=>{}));
 const view=render(<TournamentLiveView tournamentId="tour" spectator selectedTableIdOverride="table" initialReplayTarget={target}/>);
 expect(signals).toHaveLength(1);view.unmount();expect(signals[0].aborted).toBe(true);
});

it('ends initial viewer loading when a core public read never settles',async()=>{
 rpc.mockImplementation((name:string)=>name==='get_public_tournament_table_live_or_last_hand_v2'?new Promise(()=>{}):Promise.resolve({data:name==='get_public_tournament_clock_summary'?[{tournament_id:'tour',players_remaining:0,average_stack:0}]:null,error:null}));
 vi.useFakeTimers();render(<TournamentLiveView tournamentId="tour" spectator selectedTableIdOverride="table"/>);
 await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});
 expect(screen.getByText('Không tải được dữ liệu live tracker')).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Thử lại'})).toBeInTheDocument();
 expect(screen.getByText('Chưa tải được dữ liệu bàn trong thời gian chờ. Hãy thử lại.')).toBeInTheDocument();
 expect(liveSignals.length).toBeGreaterThan(0);expect(liveSignals.every(s=>s.aborted)).toBe(true);
});
it('shares an ongoing initial read with realtime refresh bursts instead of superseding it',async()=>{
 rpc.mockImplementation(()=>new Promise(()=>{}));vi.useFakeTimers();
 render(<TournamentLiveView tournamentId="tour" spectator selectedTableIdOverride="table"/>);
 await act(async()=>{events.forEach(fn=>{const event={payload:{tournamentId:'tour',components:['tables']}};fn(event);fn(event);fn(event);});await vi.advanceTimersByTimeAsync(1001);});
 expect(rpc.mock.calls.filter(([name])=>name==='get_public_tournament_table_live_or_last_hand_v2')).toHaveLength(1);
});
it('recovers the core read explicitly after timeout and never publishes its late response',async()=>{
 let done!:(v:unknown)=>void;const held=new Promise(resolve=>{done=resolve;});let hold=true;
 rpc.mockImplementation((name:string)=>name==='get_public_tournament_table_live_or_last_hand_v2'&&hold?held:Promise.resolve({error:null,data:name==='get_public_tournament_clock_summary'?[{tournament_id:'tour',players_remaining:0,average_stack:0}]:name==='get_public_tournament_table_live_or_last_hand_v2'?{access:'public',state:'waiting',tableId:'table',tableSessionId:'session',hand:null}:null}));
 vi.useFakeTimers();render(<TournamentLiveView tournamentId="tour" spectator selectedTableIdOverride="table"/>);
 await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});hold=false;
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Thử lại'}));});
 expect(screen.getByText('Waiting...')).toBeInTheDocument();
 await act(async()=>{done({data:{access:'revoked'},error:null});});
 expect(screen.getByText('Waiting...')).toBeInTheDocument();expect(screen.queryByText('Không tải được dữ liệu live tracker')).not.toBeInTheDocument();
 expect(rpc.mock.calls.filter(([name])=>name==='get_public_tournament_table_live_or_last_hand_v2')).toHaveLength(2);
});
it('aborts the current core read when the viewer unmounts',()=>{
 rpc.mockImplementation(()=>new Promise(()=>{}));const view=render(<TournamentLiveView tournamentId="tour" spectator selectedTableIdOverride="table"/>);
 expect(liveSignals).toHaveLength(3);view.unmount();expect(liveSignals.every(signal=>signal.aborted)).toBe(true);
});
it('requires a fresh access read on reconnect and rejects the pre-disconnect public reply',async()=>{
 let finish!:(value:unknown)=>void;const held=new Promise(resolve=>{finish=resolve;});let calls=0;
 rpc.mockImplementation((name:string)=>name==='get_public_tournament_table_live_or_last_hand_v2'&&++calls===1?held:Promise.resolve({error:null,data:
 name==='get_public_tournament_table_live_or_last_hand_v2'?{access:'revoked'}:
 name==='get_public_tournament_clock_summary'?[{tournament_id:'tour',players_remaining:0,average_stack:0}]:null}));
 vi.useFakeTimers();render(<TournamentLiveView tournamentId="tour" spectator selectedTableIdOverride="table"/>);
 await act(async()=>{statuses.forEach(fn=>{fn('SUBSCRIBED');fn('CHANNEL_ERROR');fn('SUBSCRIBED');});await vi.advanceTimersByTimeAsync(1001);});
 expect(rpc.mock.calls.filter(([name])=>name==='get_public_tournament_table_live_or_last_hand_v2')).toHaveLength(2);
 expect(screen.getByText('Bàn này không còn được công khai.')).toBeInTheDocument();
 await act(async()=>{finish({error:null,data:{access:'public',state:'waiting',tableId:'table',tableSessionId:'session',hand:null}});});
 expect(screen.getByText('Bàn này không còn được công khai.')).toBeInTheDocument();expect(screen.queryByText('Waiting...')).not.toBeInTheDocument();
});
it.each([false,true])('clears an already displayed hand after denial even with a summary failure=%s',async(summaryFailure)=>{
 let revoked=false;
 rpc.mockImplementation(async(name:string)=>({error:revoked&&summaryFailure&&name==='get_public_tournament_clock_summary'?{message:'summary unavailable'}:null,data:
  name==='get_public_tournament_clock_summary'?[{tournament_id:'tour',players_remaining:0,average_stack:0}]:
  name==='get_public_tournament_table_live_or_last_hand_v2'?(revoked?{access:'revoked'}:{access:'public',state:'waiting',tableId:'table',tableSessionId:'session',hand:null}):
  name==='get_public_tournament_table_hand_v2'?{id:'hand',tableId:'table',handNumber:32,status:'completed'}:null}));
 vi.useFakeTimers();render(<TournamentLiveView tournamentId="tour" spectator selectedTableIdOverride="table" initialReplayTarget={target}/>);
 await act(async()=>{await vi.advanceTimersByTimeAsync(1);});
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Deliver replay'}));});
 expect(screen.getByTestId('rendered-felt')).toBeInTheDocument();revoked=true;
 await act(async()=>{events.forEach(fn=>fn({payload:{tournamentId:'tour',components:['clock']}}));await vi.advanceTimersByTimeAsync(1001);});
 expect(screen.queryByTestId('rendered-felt')).not.toBeInTheDocument();
 expect(screen.getByText('Bàn này không còn được công khai.')).toBeInTheDocument();
});
