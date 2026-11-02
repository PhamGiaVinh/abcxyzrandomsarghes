import {render,waitFor,screen,cleanup,act,fireEvent} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {HandSelector} from './HandSelector';

const {rpc}=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc}}));
afterEach(()=>{cleanup();rpc.mockReset();vi.useRealTimers()});

it('bounds an exact-target lookup outside the list and supports explicit retry',async()=>{
 vi.useFakeTimers();
 let retryReady=false;
 const pendingLookup=new Promise(()=>{});
 rpc.mockImplementation((name:string)=>{
  if(name==='get_public_tournament_table_history_v2')return Promise.resolve({error:null,data:{access:'public',items:[],nextCursor:null}});
  if(name==='get_public_tournament_settlement')return Promise.resolve({error:null,data:null});
  return !retryReady?pendingLookup:Promise.resolve({error:null,data:{id:'hand',handNumber:32,smallBlind:100,bigBlind:200,players:[],actions:[]}});
 });
 const select=vi.fn();
 render(<HandSelector tournamentId="tour" tableId="table" spectator selectedHandId={null}
  replayTarget={{handId:'hand',tableId:'table',handNumber:32}}
  replayTargetState={{kind:'resolved',handId:'hand',tableId:'table',handNumber:32}} onSelectHand={select}/>);
 await act(async()=>{});
 await act(async()=>{await vi.advanceTimersByTimeAsync(10000)});
 expect(screen.getByRole('alert')).toHaveTextContent('Không thể tải dữ liệu replay');
 retryReady=true;
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Thử tải lại hand'})));
 expect(select).toHaveBeenCalledWith('hand',expect.objectContaining({big_blind:200}));
});

it('does not restart a default idle replay load on its own loading-state render',async()=>{
 const held=new Promise(()=>{});
 rpc.mockImplementation((name:string)=>name==='get_public_tournament_table_history_v2'?Promise.resolve({error:null,data:{access:'public',items:[{
  handId:'hand',handNumber:32,createdAt:'2026-10-20T06:00:00Z',result:{status:'pending'}
 }],nextCursor:null}}):name==='get_public_tournament_settlement'?Promise.resolve({error:null,data:null}):held);
 render(<HandSelector tournamentId="tour" tableId="table" spectator selectedHandId={null} onSelectHand={vi.fn()}/>);
 await act(async()=>{});
 expect(rpc.mock.calls.filter(call=>call[0]==='get_public_tournament_table_hand_v2')).toHaveLength(1);
});

it('carries only the exact hand verified History result into public Replay without settlement inference',async()=>{
 const verified={status:'verified',recipients:[{playerId:'player-1',entryNumber:1,seatNumber:3,name:'Player One',potAward:200,netDelta:100,potKinds:['main']}]};
 rpc.mockImplementation((name:string)=>{
  if(name==='get_public_tournament_table_history_v2')return Promise.resolve({error:null,data:{access:'public',items:[
   {handId:'hand-1',handNumber:1,createdAt:'2026-10-20T06:00:00Z',result:verified},
  ],nextCursor:null}});
  if(name==='get_public_tournament_settlement')return Promise.resolve({error:null,data:{}});
  return Promise.resolve({error:null,data:{id:'hand-1',handNumber:1,smallBlind:100,bigBlind:200,players:[],actions:[]}});
 });
 const select=vi.fn();
 render(<HandSelector tournamentId="tour" tableId="table" spectator selectedHandId={null} onSelectHand={select}/>);
 await waitFor(()=>expect(select).toHaveBeenCalledTimes(1));
 expect(select).toHaveBeenCalledWith('hand-1',expect.objectContaining({
  publicSettlement:null,
  publicHistoryResult:expect.objectContaining({status:'verified',recipients:[expect.objectContaining({playerId:'player-1',potAward:200,netDelta:100})]}),
 }));
});

it('waits for the history page before resolving a listed deep-link hand',async()=>{
 let releasePage!:(value:unknown)=>void;
 const page=new Promise(resolve=>{releasePage=resolve});
 const verified={status:'verified',recipients:[{playerId:'player-1',entryNumber:1,seatNumber:3,name:'Player One',potAward:200,netDelta:100,potKinds:['main']}]};
 rpc.mockImplementation((name:string)=>{
  if(name==='get_public_tournament_table_history_v2')return page;
  if(name==='get_public_tournament_settlement')return Promise.resolve({error:null,data:{}});
  return Promise.resolve({error:null,data:{id:'hand-1',handNumber:1,smallBlind:100,bigBlind:200,players:[],actions:[]}});
 });
 const select=vi.fn();
 render(<HandSelector tournamentId="tour" tableId="table" spectator selectedHandId={null}
  replayTarget={{handId:'hand-1',tableId:'table',handNumber:1}}
  replayTargetState={{kind:'resolved',handId:'hand-1',tableId:'table',handNumber:1}} onSelectHand={select}/>);
 expect(rpc.mock.calls.filter(call=>call[0]==='get_public_tournament_table_hand_v2')).toHaveLength(0);
 await act(async()=>{releasePage({error:null,data:{access:'public',items:[
  {handId:'hand-1',handNumber:1,createdAt:'2026-10-20T06:00:00Z',result:verified},
 ],nextCursor:null}});await page});
 await waitFor(()=>expect(select).toHaveBeenCalledTimes(1));
 expect(select).toHaveBeenCalledWith('hand-1',expect.objectContaining({
  publicHistoryResult:expect.objectContaining({status:'verified',recipients:[expect.objectContaining({playerId:'player-1',netDelta:100})]}),
 }));
 expect(rpc.mock.calls.filter(call=>call[0]==='get_public_tournament_table_hand_v2')).toHaveLength(1);
});

it('invalidates the selected replay History result when a correction returns it to pending',async()=>{
 const verified={status:'verified',recipients:[{playerId:'player-1',entryNumber:1,seatNumber:3,name:'Player One',potAward:200,netDelta:100,potKinds:['main']}]};
 let corrected=false;
 rpc.mockImplementation((name:string)=>{
  if(name==='get_public_tournament_table_history_v2')return Promise.resolve({error:null,data:{access:'public',items:[
   {handId:'hand-1',handNumber:1,createdAt:'2026-10-20T06:00:00Z',result:corrected?{status:'pending'}:verified},
  ],nextCursor:null}});
  if(name==='get_public_tournament_settlement')return Promise.resolve({error:null,data:{}});
  return Promise.resolve({error:null,data:{id:'hand-1',handNumber:1,smallBlind:100,bigBlind:200,players:[],actions:[]}});
 });
 const select=vi.fn();const loadStart=vi.fn();
 const view=render(<HandSelector tournamentId="tour" tableId="table" spectator selectedHandId={null}
  onLoadStart={loadStart} onSelectHand={select}/>);
 await waitFor(()=>expect(select).toHaveBeenCalledTimes(1));
 expect(select.mock.calls[0][1].publicHistoryResult?.status).toBe('verified');
 view.rerender(<HandSelector tournamentId="tour" tableId="table" spectator selectedHandId="hand-1"
  onLoadStart={loadStart} onSelectHand={select}/>);
 corrected=true;
 fireEvent.focus(window);
 await waitFor(()=>expect(select).toHaveBeenCalledTimes(2));
 expect(loadStart).toHaveBeenCalledTimes(2);
 expect(select.mock.calls[1][1].publicHistoryResult).toBeNull();
 expect(rpc.mock.calls.filter(call=>call[0]==='get_public_tournament_table_hand_v2')).toHaveLength(2);
});

it('ignores a late correction refresh after the replay table changes',async()=>{
 const verified={status:'verified',recipients:[{playerId:'player-1',entryNumber:1,seatNumber:3,name:'Player One',potAward:200,netDelta:100,potKinds:['main']}]};
 let releaseRefresh!:(value:unknown)=>void;
 const heldRefresh=new Promise(resolve=>{releaseRefresh=resolve});
 let oldHistoryReads=0;
 rpc.mockImplementation((name:string,args:{p_tournament_table_id?:string})=>{
  if(name==='get_public_tournament_table_history_v2'){
   if(args.p_tournament_table_id==='table-b')return Promise.resolve({error:null,data:{access:'public',items:[],nextCursor:null}});
   oldHistoryReads++;
   return oldHistoryReads===1?Promise.resolve({error:null,data:{access:'public',items:[
    {handId:'hand-1',handNumber:1,createdAt:'2026-10-20T06:00:00Z',result:verified},
   ],nextCursor:null}}):heldRefresh;
  }
  if(name==='get_public_tournament_settlement')return Promise.resolve({error:null,data:{}});
  return Promise.resolve({error:null,data:{id:'hand-1',handNumber:1,smallBlind:100,bigBlind:200,players:[],actions:[]}});
 });
 const select=vi.fn();const loadStart=vi.fn();
 const view=render(<HandSelector tournamentId="tour-a" tableId="table-a" spectator selectedHandId={null}
  onLoadStart={loadStart} onSelectHand={select}/>);
 await waitFor(()=>expect(select).toHaveBeenCalledTimes(1));
 view.rerender(<HandSelector tournamentId="tour-a" tableId="table-a" spectator selectedHandId="hand-1"
  onLoadStart={loadStart} onSelectHand={select}/>);
 fireEvent.focus(window);
 await waitFor(()=>expect(oldHistoryReads).toBe(2));
 view.rerender(<HandSelector tournamentId="tour-b" tableId="table-b" spectator selectedHandId={null}
  onLoadStart={loadStart} onSelectHand={select}/>);
 await act(async()=>{releaseRefresh({error:null,data:{access:'public',items:[
  {handId:'hand-1',handNumber:1,createdAt:'2026-10-20T06:00:00Z',result:{status:'pending'}},
 ],nextCursor:null}});await heldRefresh});
 expect(select).toHaveBeenCalledTimes(1);
 expect(loadStart).toHaveBeenCalledTimes(1);
});

it('bounds a hung hand payload, retries its exact identity and ignores the timed-out response',async()=>{
 vi.useFakeTimers();
 let releaseOld!:(value:unknown)=>void;
 const old=new Promise(resolve=>{releaseOld=resolve});
 let reads=0;
 rpc.mockImplementation((name:string)=>{
  if(name==='get_public_tournament_table_history_v2')return Promise.resolve({error:null,data:{access:'public',items:[{
   handId:'hand',handNumber:32,createdAt:'2026-10-20T06:00:00Z',result:{status:'pending'}
  }],nextCursor:null}});
  if(name==='get_public_tournament_settlement')return Promise.resolve({error:null,data:null});
  reads++;return reads===1?old:Promise.resolve({error:null,data:{id:'hand',handNumber:32,smallBlind:100,bigBlind:200,players:[],actions:[]}});
 });
 const select=vi.fn();
 const idle={kind:'idle'} as const;
 render(<HandSelector tournamentId="tour" tableId="table" spectator selectedHandId={null} replayTargetState={idle} onSelectHand={select}/>);
 await act(async()=>{});
 expect(reads).toBe(1);
 await act(async()=>{await vi.advanceTimersByTimeAsync(10000)});
 expect(screen.getByRole('alert')).toHaveTextContent('Không thể tải dữ liệu replay');
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Thử tải lại hand'})));
 expect(select).toHaveBeenCalledTimes(1);
 expect(select).toHaveBeenCalledWith('hand',expect.objectContaining({small_blind:100,big_blind:200}));
 await act(async()=>{releaseOld({error:null,data:{id:'hand',smallBlind:1,bigBlind:2}});await old});
 expect(select).toHaveBeenCalledTimes(1);
 expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('reports a rejected history read and recovers only after the user retries',async()=>{
 rpc.mockRejectedValueOnce(new TypeError('Failed to fetch'));
 rpc.mockResolvedValue({data:{access:'public',items:[],nextCursor:null},error:null});
 render(<HandSelector tournamentId="tour" tableId="table" spectator selectedHandId={null} onSelectHand={vi.fn()}/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('Không thể tải lịch sử hand');
 expect(rpc).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole('button',{name:'Thử tải lại lịch sử'}));
 await waitFor(()=>expect(screen.queryByRole('alert')).not.toBeInTheDocument());
 expect(rpc).toHaveBeenCalledTimes(2);
 expect(screen.getByRole('combobox')).toHaveTextContent('Chưa có hand đã xong');
});

it('bounds a hung history read and allows an explicit retry without accepting the late list',async()=>{
 vi.useFakeTimers();
 let finishLate!:(value:unknown)=>void;
 rpc.mockImplementationOnce(()=>new Promise(resolve=>{finishLate=resolve}));
 rpc.mockResolvedValue({data:{access:'public',items:[],nextCursor:null},error:null});
 render(<HandSelector tournamentId="tour" tableId="table" spectator selectedHandId={null} onSelectHand={vi.fn()}/>);
 await act(async()=>{await vi.advanceTimersByTimeAsync(10000)});
 expect(screen.getByRole('alert')).toHaveTextContent('Không thể tải lịch sử hand');
 fireEvent.click(screen.getByRole('button',{name:'Thử tải lại lịch sử'}));
 await act(async()=>{});
 expect(screen.getByRole('combobox')).toHaveTextContent('Chưa có hand đã xong');
 await act(async()=>finishLate({data:{access:'revoked'},error:null}));
 expect(screen.queryByRole('alert')).not.toBeInTheDocument();
 expect(rpc).toHaveBeenCalledTimes(2);
});

it('waits for replay target resolution instead of reporting a missing table',async()=>{
 rpc.mockResolvedValue({error:null,data:{access:'public',items:[],nextCursor:null}});
 render(<HandSelector tournamentId="tour" tableId={null} spectator selectedHandId={null}
  replayTarget={{handId:'hand',tableId:'table',handNumber:2}}
  replayTargetState={{kind:'loading'}} onSelectHand={vi.fn()}/>);
 await waitFor(()=>expect(screen.queryByRole('alert')).not.toBeInTheDocument());
 expect(screen.getByRole('combobox')).toHaveTextContent('Đang tải...');
 expect(rpc).not.toHaveBeenCalled();
});

it('still reports a missing table when there is no replay target being resolved',async()=>{
 render(<HandSelector tournamentId="tour" tableId={null} spectator selectedHandId={null} onSelectHand={vi.fn()}/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('Chọn bàn để xem lịch sử hand.');
 expect(rpc).not.toHaveBeenCalled();
});

it.each([{tour:'tourB',table:'tableB'},{tour:'tourA',table:'tableA'}])('ignores an old hand while resolving a new target in $tour/$table',async({tour,table})=>{
 let releaseOld!:(value:unknown)=>void;
 let releaseNew!:(value:unknown)=>void;
 const heldOld=new Promise(resolve=>{releaseOld=resolve});
 const heldNew=new Promise(resolve=>{releaseNew=resolve});
 let oldReads=0;
 rpc.mockImplementation((name:string,args:{p_hand_id?:string;p_tournament_table_id?:string})=>{
  if(name==='get_public_tournament_table_history_v2')return Promise.resolve({error:null,data:{access:'public',items:[],nextCursor:null}});
  if(name==='get_public_tournament_settlement')return Promise.resolve({error:null,data:null});
  if(args.p_hand_id==='old'){
   oldReads++;return oldReads===1?Promise.resolve({error:null,data:{id:'old',handNumber:1}}):heldOld;
  }
  return heldNew;
 });
 const select=vi.fn();
 const view=render(<HandSelector tournamentId="tourA" tableId="tableA" spectator selectedHandId={null}
  replayTarget={{handId:'old',tableId:'tableA',handNumber:1}}
  replayTargetState={{kind:'resolved',handId:'old',tableId:'tableA',handNumber:1}} onSelectHand={select}/>);
 await waitFor(()=>expect(oldReads).toBeGreaterThanOrEqual(2));
 view.rerender(<HandSelector tournamentId={tour} tableId={table} spectator selectedHandId={null}
  replayTarget={{handId:'new',tableId:table,handNumber:2}}
  replayTargetState={{kind:'resolved',handId:'new',tableId:table,handNumber:2}} onSelectHand={select}/>);
 await act(async()=>{
  releaseOld({error:null,data:{id:'old',handNumber:1,smallBlind:100,bigBlind:200,players:[],actions:[]}});
  await heldOld;
 });
 expect(select).not.toHaveBeenCalled();
 await act(async()=>{
  releaseNew({error:null,data:{id:'new',handNumber:2,smallBlind:200,bigBlind:400,players:[],actions:[]}});
  await heldNew;
 });
 await waitFor(()=>expect(select).toHaveBeenCalledWith('new',expect.objectContaining({hand_id:'new',small_blind:200,big_blind:400})));
 expect(select.mock.calls.every(call=>call[0]==='new')).toBe(true);
});

it('keeps frozen blinds for an exact public replay target outside the history page',async()=>{
 rpc.mockImplementation(async(name:string)=>({error:null,data:name==='get_public_tournament_table_history_v2'
  ?{access:'public',items:[],nextCursor:null}:name==='get_public_tournament_settlement'?null
  :{id:'hand',tableId:'table',handNumber:2,buttonSeat:2,board:[],pot:300,
    smallBlind:100,bigBlind:200,ante:0,levelNumber:1,players:[],actions:[]}}));
 const select=vi.fn();
 render(<HandSelector tournamentId="tour" tableId="table" spectator selectedHandId={null}
  replayTarget={{handId:'hand',tableId:'table',handNumber:2}}
  replayTargetState={{kind:'resolved',handId:'hand',tableId:'table',handNumber:2}}
  onSelectHand={select}/>);
 await waitFor(()=>expect(select).toHaveBeenCalled());
 expect(select.mock.calls.at(-1)?.[1]).toMatchObject({big_blind:200,small_blind:100,ante:0,level_number:1});
});
it('offers an explicit parent target retry after resolver failure without inventing a different hand',async()=>{
 const retry=vi.fn();render(<HandSelector tournamentId="tour" tableId={null} spectator selectedHandId={null}
 replayTarget={{handId:'hand',tableId:'table',handNumber:32}} replayTargetState={{kind:'query_error'}}
 onRetryReplayTarget={retry} onSelectHand={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'Thử tìm lại hand'}));expect(retry).toHaveBeenCalledTimes(1);
 expect(rpc).not.toHaveBeenCalled();
});
