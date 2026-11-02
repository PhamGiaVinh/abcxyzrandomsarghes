// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
const mock = vi.hoisted(() => ({ rpc: vi.fn(), error: vi.fn(),info:vi.fn(), staleOrphan: false, currentOrphan: false,
 getUser:vi.fn(), invoke:vi.fn(), warning:vi.fn(),deadBlind:false,resumeDeadBlind:false,previousVoided:false,lineageMissing:false,
 resumeSb:6 as number|null,resumeBb:7 as number|null,undoReads:false,
 listeners: [] as Array<(event:string,session:{user:{id:string}}|null)=>void>,
 resumeReads: [] as Record<string, unknown>[] }));
vi.mock("sonner", () => ({ toast: { error: mock.error, success: vi.fn(), info: mock.info,warning:mock.warning } }));
vi.mock('@/lib/trackerSound',async importOriginal=>({
 ...await importOriginal<typeof import('@/lib/trackerSound')>(),playTrackerSound:vi.fn(),
}));
vi.mock('@/lib/tournament/readBlindLineage',async importOriginal=>({
 ...await importOriginal<typeof import('@/lib/tournament/readBlindLineage')>(),
 readBlindLineageState:async()=>({available:true,lineage:mock.deadBlind&&!mock.lineageMissing?{
  previousDealtSeats:[1,3,5,6,7,8,9],previousButtonSeat:4,previousSbPosition:5,previousBbSeat:6,
 }:null}),
 readHandBlindLevel:async()=>({level_number:1,small_blind:100,big_blind:100,ante:0}),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
 auth: { getUser: () => mock.getUser() ?? Promise.resolve({ data: { user: { id: "actor" } } }),
  onAuthStateChange: (listener:(event:string,session:{user:{id:string}}|null)=>void) => {
   mock.listeners.push(listener);return { data: { subscription: { unsubscribe: () => { mock.listeners=mock.listeners.filter(item=>item!==listener); } } } };
  } },
 rpc: mock.rpc,
 functions: {invoke: mock.invoke},
 from: (table: string) => {
  const result: {data:unknown;error:null} = { data: table === "tournaments" ? { id: "tour" }
   :table==='hand_actions'&&mock.resumeDeadBlind?[{player_id:'player-7',action_type:'post_bb',action_amount:100,action_order:1,street:'preflop'}]:[], error: null };
  // Resume now requires the actual frozen participants, even before cards are
  // shown. An empty mock result is missing evidence, not six empty card pairs.
  if(table==='hand_players'&&mock.resumeDeadBlind)result.data=[1,3,5,7,8,9].map(seat=>({
   player_id:`player-${seat}`,entry_number:1,hole_cards:[],
  }));
  const filters: Record<string, unknown> = {};
  const chain: any = { then: (resolve: any) => Promise.resolve(result).then(resolve),
   maybeSingle: async () => ({ data: table === "tournaments" ? { id: "tour", club_id:"club" }
    :table==='tournament_hands'&&mock.resumeDeadBlind?{id:'current-hand',hand_number:5,button_seat:5,status:'in_progress',is_voided:false,source_revision:7}
    :table==='hand_actions'&&mock.undoReads?{id:'last-action'}
    :table==='tournament_hands'&&mock.deadBlind&&!filters.status?{id:'previous',button_seat:4,status:'completed',is_voided:mock.previousVoided}
    : table === "tournament_hands" && mock.staleOrphan && filters.status === "in_progress"
      && filters.table_session_id !== "session-a"
      ? { id: "old-session-hand", hand_number: 99 }
      : table === "tournament_hands" && mock.currentOrphan && filters.status === "in_progress"
        && filters.table_session_id === "session-a" ? { id: "current-session-hand", hand_number: 2 } : null,
    error: null }),
   single: async () => {
    if (table === "tournament_hands") mock.resumeReads.push({ ...filters });
    if(table==='tournament_hands'&&mock.resumeDeadBlind)return {data:{id:'current-hand',hand_number:5,
     table_id:'logical-a',button_seat:5,community_cards:[],tracker_sb_position:mock.resumeSb,tracker_bb_position:mock.resumeBb},error:null};
    return { data: null, error: { message: "Synthetic resume read stopped before writes" } };
   } };
  for (const method of ["select", "eq", "filter", "order", "limit", "in", "neq", "is", "or"]) chain[method] = () => chain;
  chain.eq = (key: string, value: unknown) => { filters[key] = value; return chain; };
  chain.filter = (key: string, _operator: string, value: unknown) => { filters[key] = value; return chain; };
  return chain;
 },
} }));
import { useStandaloneHandInput } from "./useStandaloneHandInput";
const tables = ["a", "b"].map(id => ({ table_id: id, tournament_table_id: `logical-${id}`,
 table_session_id: `session-${id}`, control_epoch: 1, max_seats: 9, table_name: id, player_count: 0, has_live_hand: false, can_manual_cards: true }));
const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;
const snapshot = (args: any) => ({ data: { ok: true, tournament_table_id: args.p_tournament_table_id,
 table_session_id: args.p_table_session_id, control_epoch: args.p_expected_epoch,
  seats: Array.from({ length: 9 }, (_, i) => ({ seat_number: i + 1,
  seat: mock.deadBlind&&[1,3,5,7,8,9].includes(i+1)?{
   player_id:`player-${i+1}`,entry_number:1,seat_number:i+1,chip_count:20000,player_name:`TEST ${i+1}`,
  }:i === 0 && (mock.staleOrphan || mock.currentOrphan
   || mock.rpc.mock.calls.filter(([name]) => name === "set_tracker_table_roster_seat_v2").length >= 2)
   ? { player_id: "player", entry_number: 1, seat_number: 1, chip_count: 20000, player_name: "TEST" } : null,
  token: "empty" })) }, error: null });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks(); mock.staleOrphan = false; mock.currentOrphan = false;
 mock.deadBlind=false;
 mock.resumeDeadBlind=false;
 mock.previousVoided=false;
 mock.lineageMissing=false;
 mock.resumeSb=6;mock.resumeBb=7;mock.undoReads=false;
 mock.getUser.mockReset(); mock.invoke.mockReset();
 mock.resumeReads.length = 0; sessionStorage.clear(); localStorage.clear(); });
async function prepareUndo(reply:(body:Record<string,unknown>)=>unknown,record=true){
  mock.deadBlind=true;mock.resumeDeadBlind=true;mock.undoReads=true;
  mock.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
   if(name==='get_tracker_hand_input_tables_v4')return {data:{ok:true,tables},error:null};
   if(name==='get_tracker_roster_snapshot_v2')return snapshot(args);
   if(name==='heartbeat_lock')return {data:{status:'success',locked_by:'actor'},error:null};
   return {data:name==='is_club_tracker'?true:{ok:true,locks:[]},error:null};
  });
  mock.invoke.mockImplementation(async(_name,args)=>({data:args.body.action==='undo_last_action_v1'?await reply(args.body):{status:'success',data:{status:'success'}},error:null}));
  const h=renderHook(()=>useStandaloneHandInput('tour'),{wrapper});
  await waitFor(()=>expect(h.result.current.availableTables).toHaveLength(2));
  await act(async()=>h.result.current.handleTableChange('a'));
  await waitFor(()=>expect(h.result.current.handStarted).toBe(true));
  if(record){act(()=>h.result.current.handleDockAction('call'));
    await waitFor(()=>expect(h.result.current.canUndo).toBe(true));}
  return h;
}
const undoReceipt=(body:Record<string,unknown>,duplicate=false)=>({status:'success',data:{ok:true,duplicate,operation:'undo_open_hand',
 hand_id:body.hand_id,undone_action_id:body.expected_action_id,source_revision:Number(body.expected_source_revision)+1}});
describe("actual roster hook intent", () => {
 it('cancels only the exact confirmed journal and retains it across a lost response',async()=>{
  const h=await prepareUndo(()=>null);await act(async()=>h.result.current.handleUndo());
  const saved=sessionStorage.getItem('tracker-undo:tour:current-hand')!,pending=JSON.parse(saved);
  const normal=mock.rpc.getMockImplementation()!;let cancelled=false;
  mock.rpc.mockImplementation(async(name,args)=>{
   if(name==='cancel_tracker_undo_intent_v1'){cancelled=true;return {data:null,error:{message:'response lost'}};}
   if(name==='get_tracker_undo_receipt_v1'&&cancelled)return {data:{ok:true,outcome:'cancelled',actor_id:'actor',request_id:pending.idempotencyKey,
    receipt:{ok:true,operation:'cancel_undo_open_hand',cancelled:true,actor_id:'actor',request_id:pending.idempotencyKey,
     tournament_id:'tour',tournament_table_id:'logical-a',hand_id:'current-hand',expected_action_id:pending.expectedActionId,
     expected_source_revision:pending.expectedSourceRevision}},error:null};
   return normal(name,args);
  });
  expect(h.result.current.pendingUndoCancellationToken).toBe(saved);
  await act(async()=>h.result.current.handleCancelPendingUndo(saved+' '));
  expect(cancelled).toBe(false);
  await act(async()=>h.result.current.handleCancelPendingUndo(saved));
  expect(cancelled).toBe(true);expect(sessionStorage.getItem('tracker-undo:tour:current-hand')).toBe(saved);
  expect(mock.rpc.mock.calls.filter(([name])=>name==='cancel_tracker_undo_intent_v1')).toHaveLength(1);
  await act(async()=>h.result.current.handleReconcilePendingUndo());
  expect(sessionStorage.getItem('tracker-undo:tour:current-hand')).toBeNull();
 });
 it('single-flights cancellation and ignores its completion after actor changes',async()=>{
  const h=await prepareUndo(()=>null);await act(async()=>h.result.current.handleUndo());
  const saved=sessionStorage.getItem('tracker-undo:tour:current-hand')!;
  const normal=mock.rpc.getMockImplementation()!;let finish!:(value:unknown)=>void;
  mock.rpc.mockImplementation((name,args)=>name==='cancel_tracker_undo_intent_v1'
   ?new Promise(resolve=>{finish=resolve;}):normal(name,args));
  let first!:Promise<void>,second!:Promise<void>;
  await act(async()=>{first=h.result.current.handleCancelPendingUndo(saved);second=h.result.current.handleCancelPendingUndo(saved);});
  await waitFor(()=>expect(finish).toBeDefined());
  expect(mock.rpc.mock.calls.filter(([name])=>name==='cancel_tracker_undo_intent_v1')).toHaveLength(1);
  mock.getUser.mockResolvedValue({data:{user:{id:'another-actor'}}});
  await act(async()=>{for(const listener of [...mock.listeners])listener('SIGNED_IN',{user:{id:'another-actor'}});});
  await act(async()=>{finish({data:{ok:true,outcome:'cancelled'},error:null});await Promise.all([first,second]);});
  expect(sessionStorage.getItem('tracker-undo:tour:current-hand')).toBe(saved);
  expect(h.result.current.pendingUndoCancellationToken).toBeNull();
 });
 it.each([[409,'uat_capability_disabled',false],[502,'uat_capability_disabled',true],[409,'undo_receipt_unconfirmed',true],
  [409,'dealer_assignment_not_unique',false],[502,'dealer_assignment_not_unique',true],
  [409,'actor_not_allowed',false],[409,'tracker_lock_not_owned',false],[409,'undo_boundary_blind',false]] as const)(
  'distinguishes a first-attempt prewrite gate denial from unknown outcomes: %s/%s',async(status,code,unknown)=>{
   const h=await prepareUndo(()=>null);
   mock.invoke.mockImplementation(async(_name,args)=>args.body.action==='undo_last_action_v1'
    ?{data:null,error:{context:new Response(JSON.stringify({error:code,code}),{status,headers:{'Content-Type':'application/json'}})}}
    :{data:{status:'success',data:{status:'success'}},error:null});
   const before=h.result.current.players;
   await act(async()=>h.result.current.handleUndo());
   expect(h.result.current.pendingUndo).toBe(unknown);
   expect(h.result.current.actionSyncBlocked).toBe(unknown);
   expect(sessionStorage.getItem('tracker-undo:tour:current-hand')===null).toBe(!unknown);
   expect(h.result.current.players).toEqual(before); // A rejection never pops the local action snapshot.
   expect(h.result.current.canUndo).toBe(true);
  });
 it.each(['pending','corrupt','late_pending'])('blocks next-hand Start while durable Finish is %s, despite valid start authority',async(kind)=>{
  const id=(n:number)=>`b1360000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const actor=id(1),tour=id(2),logical=id(3),hand=id(4),session=id(5),physical=id(7);
  const intent={actor_id:actor,tournament_id:tour,tournament_table_id:logical,hand_id:hand,
   table_session_id:session,control_epoch:1,source_revision:1,request_id:id(6),
   payload:{hand_time:'2026-10-20T00:00:00Z',players:[{player_id:id(8),starting_stack:20000,ending_stack:20000}],actions:[],side_pots:[],community_cards:[],pot_size:0}};
  const journalKey=`vinpoker:manual-finish:${actor}:${tour}:${logical}:${hand}`;
  if(kind!=='late_pending')localStorage.setItem(journalKey,kind==='pending'?JSON.stringify(intent):'{');
  mock.deadBlind=true;
  mock.getUser.mockResolvedValue({data:{user:{id:actor}},error:null});
  mock.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
   if(name==='get_tracker_hand_input_tables_v4')return {data:{ok:true,tables:[{...tables[0],table_id:physical,tournament_table_id:logical,table_session_id:session}]},error:null};
   if(name==='get_tracker_roster_snapshot_v2')return snapshot(args);
   return {data:name==='is_club_tracker'?true:name==='get_next_hand_number'?3:{ok:true,locks:[]},error:null};
  });
  mock.invoke.mockResolvedValue({data:{status:'success',data:{status:'success',hand_id:'new-hand'}},error:null});
  const h=renderHook(()=>useStandaloneHandInput(tour),{wrapper});
  await waitFor(()=>expect(h.result.current.availableTables).toHaveLength(1));
  await act(async()=>h.result.current.handleTableChange(physical));
  await waitFor(()=>expect(h.result.current.startCapability).toBe('allowed'));
  expect(h.result.current.players).toHaveLength(6);expect(h.result.current.buttonConfirmed).toBe(true);
  if(kind==='pending')expect(h.result.current.pendingFinish?.request_id).toBe(intent.request_id);
  else if(kind==='corrupt')expect(h.result.current.pendingFinishError).toMatch(/Finish/);
  else{
   expect(h.result.current.pendingFinish).toBeNull();expect(h.result.current.startDisabledReason).toBeNull();
   // Simulate a different tab creating the journal after the verified render.
   localStorage.setItem(journalKey,JSON.stringify(intent));
  }
  await act(async()=>h.result.current.handleStartHand());
  expect(mock.invoke).not.toHaveBeenCalled();expect(h.result.current.handStarted).toBe(false);
  expect(h.result.current.startDisabledReason).toMatch(/Finish/);
  expect(localStorage.getItem(journalKey)).not.toBeNull();
 });
 it.each(['recorded','not_found','malformed'])('recovers an unresolved Undo by pure receipt read only: %s',async(outcome)=>{
  const h=await prepareUndo(()=>null);
  await act(async()=>h.result.current.handleUndo());
  const saved=sessionStorage.getItem('tracker-undo:tour:current-hand')!;
  const pending=JSON.parse(saved),beforeWrites=mock.invoke.mock.calls.length;
  const normal=mock.rpc.getMockImplementation()!;
  mock.rpc.mockImplementation(async(name,args)=>name==='get_tracker_undo_receipt_v1'?{data:{ok:true,outcome,
   actor_id:'actor',request_id:pending.idempotencyKey,receipt:outcome==='recorded'?undoReceipt({hand_id:'current-hand',
    expected_action_id:pending.expectedActionId,expected_source_revision:pending.expectedSourceRevision},true).data:null},error:null}:normal(name,args));
  expect(h.result.current.pendingUndo).toBe(true);
  await act(async()=>h.result.current.handleReconcilePendingUndo());
  expect(mock.invoke).toHaveBeenCalledTimes(beforeWrites);
  expect(mock.rpc.mock.calls.filter(([name])=>name==='get_tracker_undo_receipt_v1')).toHaveLength(1);
  if(outcome==='recorded'){
   expect(sessionStorage.getItem('tracker-undo:tour:current-hand')).toBeNull();
   expect(h.result.current.canUndo).toBe(false); // Reload canonical state, never pop the old local snapshot.
  }else{
   expect(sessionStorage.getItem('tracker-undo:tour:current-hand')).toBe(saved);
   expect(h.result.current.actionSyncBlocked).toBe(true);
  }
 });
 it.each([false,true])('accepts only an exact server cancellation proof (mismatch=%s)',async(mismatch)=>{
  const h=await prepareUndo(()=>null);await act(async()=>h.result.current.handleUndo());
  const saved=sessionStorage.getItem('tracker-undo:tour:current-hand')!,pending=JSON.parse(saved);
  const beforeWrites=mock.invoke.mock.calls.length,normal=mock.rpc.getMockImplementation()!;
  mock.rpc.mockImplementation(async(name,args)=>name==='get_tracker_undo_receipt_v1'?{data:{ok:true,outcome:'cancelled',
   actor_id:'actor',request_id:pending.idempotencyKey,receipt:{ok:true,operation:'cancel_undo_open_hand',cancelled:true,
    actor_id:'actor',request_id:pending.idempotencyKey,tournament_id:'tour',tournament_table_id:'logical-a',
    hand_id:'current-hand',expected_action_id:mismatch?'another-action':pending.expectedActionId,
    expected_source_revision:pending.expectedSourceRevision}},error:null}:normal(name,args));
  await act(async()=>h.result.current.handleReconcilePendingUndo());
  expect(mock.invoke).toHaveBeenCalledTimes(beforeWrites);
  if(mismatch){expect(sessionStorage.getItem('tracker-undo:tour:current-hand')).toBe(saved);}
  else{expect(sessionStorage.getItem('tracker-undo:tour:current-hand')).toBeNull();expect(h.result.current.canUndo).toBe(false);}
 });
 it('does not erase an Undo journal when actor changes during receipt lookup',async()=>{
  const h=await prepareUndo(()=>null);await act(async()=>h.result.current.handleUndo());
  const saved=sessionStorage.getItem('tracker-undo:tour:current-hand')!,pending=JSON.parse(saved);
  let finish!:(value:unknown)=>void;const normal=mock.rpc.getMockImplementation()!;
  mock.rpc.mockImplementation((name,args)=>name==='get_tracker_undo_receipt_v1'?new Promise(resolve=>{finish=resolve;}):normal(name,args));
  let read!:Promise<void>;await act(async()=>{read=h.result.current.handleReconcilePendingUndo();});
  await waitFor(()=>expect(finish).toBeDefined());
  mock.getUser.mockResolvedValue({data:{user:{id:'another-actor'}}});
  await act(async()=>{for(const listener of [...mock.listeners])listener('SIGNED_IN',{user:{id:'another-actor'}});});
  await act(async()=>{finish({data:{ok:true,outcome:'recorded',actor_id:'actor',request_id:pending.idempotencyKey,
    receipt:undoReceipt({hand_id:'current-hand',expected_action_id:pending.expectedActionId,expected_source_revision:pending.expectedSourceRevision},true).data},error:null});await read;});
  expect(sessionStorage.getItem('tracker-undo:tour:current-hand')).toBe(saved);
 });
 it('offers receipt lookup after remount without an undo snapshot or writer replay',async()=>{
  const first=await prepareUndo(()=>null);await act(async()=>first.result.current.handleUndo());
  const saved=sessionStorage.getItem('tracker-undo:tour:current-hand')!,pending=JSON.parse(saved);first.unmount();
  const second=await prepareUndo(()=>null,false);
  expect(second.result.current.canUndo).toBe(false);expect(second.result.current.pendingUndo).toBe(true);
  const beforeWrites=mock.invoke.mock.calls.length,normal=mock.rpc.getMockImplementation()!;
  mock.rpc.mockImplementation(async(name,args)=>name==='get_tracker_undo_receipt_v1'?{data:{ok:true,outcome:'recorded',
   actor_id:'actor',request_id:pending.idempotencyKey,receipt:undoReceipt({hand_id:'current-hand',
    expected_action_id:pending.expectedActionId,expected_source_revision:pending.expectedSourceRevision},true).data},error:null}:normal(name,args));
  await act(async()=>second.result.current.handleReconcilePendingUndo());
  expect(mock.invoke).toHaveBeenCalledTimes(beforeWrites);
  expect(sessionStorage.getItem('tracker-undo:tour:current-hand')).toBeNull();
  expect(second.result.current.canUndo).toBe(false);
 });
 it('single-flights and bounds a hung receipt read without clearing its journal',async()=>{
  const h=await prepareUndo(()=>null);await act(async()=>h.result.current.handleUndo());
  const saved=sessionStorage.getItem('tracker-undo:tour:current-hand')!;
  const normal=mock.rpc.getMockImplementation()!;let finish!:(value:unknown)=>void;
  mock.rpc.mockImplementation((name,args)=>name==='get_tracker_undo_receipt_v1'?new Promise(resolve=>{finish=resolve;}):normal(name,args));
  vi.useFakeTimers();
  try{
   let first!:Promise<void>,second!:Promise<void>;
   await act(async()=>{first=h.result.current.handleReconcilePendingUndo();second=h.result.current.handleReconcilePendingUndo();});
   await act(async()=>{await vi.advanceTimersByTimeAsync(11000);await Promise.all([first,second]);});
   expect(mock.rpc.mock.calls.filter(([name])=>name==='get_tracker_undo_receipt_v1')).toHaveLength(1);
   expect(h.result.current.undoRecoveryBusy).toBe(false);
   expect(h.result.current.undoRecoveryError).toBeTruthy();
   expect(sessionStorage.getItem('tracker-undo:tour:current-hand')).toBe(saved);
   await act(async()=>{finish({data:{ok:true,outcome:'recorded'},error:null});});
   expect(sessionStorage.getItem('tracker-undo:tour:current-hand')).toBe(saved);
  }finally{cleanup();vi.useRealTimers();}
 });
 it.each([null,{}, {status:'success',data:{ok:false,error:'dealer_assignment_not_unique'}},
  {status:'success',data:{ok:true,duplicate:false,operation:'undo_open_hand',hand_id:'another-hand',undone_action_id:'last-action',source_revision:8}}])(
  'does not restore a local action snapshot or erase the saved key on unconfirmed undo %j',async(undoReply)=>{
  const h=await prepareUndo(()=>undoReply);
  const actions=h.result.current.actions,players=h.result.current.players;
  await act(async()=>h.result.current.handleUndo());
  expect(mock.invoke).toHaveBeenCalledTimes(2);
  expect(h.result.current.actions).toEqual(actions);expect(h.result.current.players).toEqual(players);
  expect(h.result.current.canUndo).toBe(true);
  expect(h.result.current.actionSyncBlocked).toBe(true);
  expect(sessionStorage.getItem('tracker-undo:tour:current-hand')).not.toBeNull();
 });
 it.each([false,true])('restores the local snapshot only on exact confirmed undo receipt duplicate=%s',async(duplicate)=>{
  const h=await prepareUndo(body=>undoReceipt(body,duplicate));
  expect(h.result.current.actions).toHaveLength(2);
  await act(async()=>h.result.current.handleUndo());
  expect(h.result.current.actions).toHaveLength(1);expect(h.result.current.canUndo).toBe(false);
  expect(h.result.current.syncPhase).toBe('sent');
  expect(h.result.current.syncLabel).toBe('Đã hoàn tác hành động cuối');
  expect(sessionStorage.getItem('tracker-undo:tour:current-hand')).toBeNull();
 });
 it('retries an unknown undo with the identical saved payload and key',async()=>{
  let unknown=true;const h=await prepareUndo(body=>unknown?null:undoReceipt(body,true));
  await act(async()=>h.result.current.handleUndo());
  const saved=sessionStorage.getItem('tracker-undo:tour:current-hand');expect(saved).not.toBeNull();
  unknown=false;await act(async()=>h.result.current.handleUndo());
  expect(mock.invoke.mock.calls[1][1].body).toEqual(mock.invoke.mock.calls[2][1].body);
  expect(h.result.current.actions).toHaveLength(1);expect(sessionStorage.getItem('tracker-undo:tour:current-hand')).toBeNull();
  expect(h.result.current.actionSyncBlocked).toBe(false);
 });
 it.each(['uat_capability_disabled','dealer_assignment_not_unique','tracker_lock_not_owned'])(
  'never clears an earlier unknown intent when a later attempt returns %s',async(code)=>{
   const h=await prepareUndo(()=>null);await act(async()=>h.result.current.handleUndo());
   const saved=sessionStorage.getItem('tracker-undo:tour:current-hand'),players=h.result.current.players;
   mock.invoke.mockResolvedValue({data:null,error:{context:new Response(JSON.stringify({error:code,code}),{status:409})}});
   await act(async()=>h.result.current.handleUndo());
   expect(sessionStorage.getItem('tracker-undo:tour:current-hand')).toBe(saved);
   expect(h.result.current.pendingUndo).toBe(true);expect(h.result.current.actionSyncBlocked).toBe(true);
   expect(h.result.current.players).toEqual(players);
  });
 it('does not dispatch two Undo writers from a double click',async()=>{
  const replies:Array<()=>void>=[];
  const h=await prepareUndo(body=>new Promise(resolve=>replies.push(()=>resolve(undoReceipt(body)))));
  let first!:Promise<void>,second!:Promise<void>;
  await act(async()=>{first=h.result.current.handleUndo();second=h.result.current.handleUndo();});
  await waitFor(()=>expect(replies.length).toBeGreaterThan(0));
  const writes=mock.invoke.mock.calls.filter(([,args])=>args.body.action==='undo_last_action_v1').length;
  await act(async()=>{for(const reply of replies)reply();await Promise.all([first,second]);});
  expect(writes).toBe(1);
 });
 it('ignores a previous actor undo completion and retains its unresolved key',async()=>{
  let finish!:()=>void;
  const h=await prepareUndo(body=>new Promise(resolve=>{finish=()=>resolve(undoReceipt(body));}));
  let undo!:Promise<void>;await act(async()=>{undo=h.result.current.handleUndo();});
  await waitFor(()=>expect(finish).toBeDefined());
  const saved=sessionStorage.getItem('tracker-undo:tour:current-hand');expect(saved).not.toBeNull();
  mock.getUser.mockResolvedValue({data:{user:{id:'another-actor'}}});
  await act(async()=>{for(const listener of [...mock.listeners])listener('SIGNED_IN',{user:{id:'another-actor'}});});
  const actions=h.result.current.actions,players=h.result.current.players;
  await act(async()=>{finish();await undo;});
  expect(sessionStorage.getItem('tracker-undo:tour:current-hand')).toBe(saved);
  expect(h.result.current.actions).toEqual(actions);expect(h.result.current.players).toEqual(players);
 });
 it('does not adopt a legacy actorless Undo key as a new authenticated operation',async()=>{
  const h=await prepareUndo(body=>undoReceipt(body));
  const saved=JSON.stringify({expectedActionId:'last-action',expectedSourceRevision:7,idempotencyKey:'old-saved-key'});
  sessionStorage.setItem('tracker-undo:tour:current-hand',saved);
  await act(async()=>h.result.current.handleUndo());
  expect(mock.invoke).toHaveBeenCalledTimes(1);
  expect(h.result.current.canUndo).toBe(true);expect(sessionStorage.getItem('tracker-undo:tour:current-hand')).toBe(saved);
 });
 it('does not let a new action race an unresolved Undo snapshot',async()=>{
  let finish!:()=>void;
  const h=await prepareUndo(body=>new Promise(resolve=>{finish=()=>resolve(undoReceipt(body));}));
  let undo!:Promise<void>;await act(async()=>{undo=h.result.current.handleUndo();});
  await waitFor(()=>expect(finish).toBeDefined());
  act(()=>h.result.current.handleDockAction('call'));
  await act(async()=>{await Promise.resolve();});
  const actionWrites=mock.invoke.mock.calls.filter(([,args])=>args.body.action==='record_action').length;
  await act(async()=>{finish();await undo;});
  expect(actionWrites).toBe(1);
 });
 it('bounds a hung Undo, retains its key, and ignores late success after the observation deadline',async()=>{
  let finish!:()=>void;
  const h=await prepareUndo(body=>new Promise(resolve=>{finish=()=>resolve(undoReceipt(body));}));
  const actions=h.result.current.actions,players=h.result.current.players;
  vi.useFakeTimers();
  try{
   let undo!:Promise<void>;await act(async()=>{undo=h.result.current.handleUndo();});
   await act(async()=>{await vi.advanceTimersByTimeAsync(21000);await undo;});
   const saved=sessionStorage.getItem('tracker-undo:tour:current-hand');expect(saved).not.toBeNull();
   expect(h.result.current.actionSyncBlocked).toBe(true);
   await act(async()=>{finish();});
   expect(sessionStorage.getItem('tracker-undo:tour:current-hand')).toBe(saved);
   expect(h.result.current.actions).toEqual(actions);expect(h.result.current.players).toEqual(players);
  }finally{cleanup();vi.useRealTimers();}
 });
 it('does not dispatch Undo while a confirmed-action request is still in flight',async()=>{
  const h=await prepareUndo(body=>undoReceipt(body));
  let finish!:(value:unknown)=>void;const normal=mock.invoke.getMockImplementation()!;
  mock.invoke.mockImplementation((name,args)=>args.body.action==='record_action'?new Promise(resolve=>{finish=resolve;}):normal(name,args));
  act(()=>h.result.current.handleDockAction('call'));
  await waitFor(()=>expect(finish).toBeDefined());
  await act(async()=>h.result.current.handleUndo());
  expect(mock.invoke.mock.calls.filter(([,args])=>args.body.action==='undo_last_action_v1')).toHaveLength(0);
  await act(async()=>{finish({data:{status:'success',data:{status:'success'}},error:null});});
 });
 it('does not allow a new action after remount with an unresolved prior Undo journal',async()=>{
  const first=await prepareUndo(()=>null);
  await act(async()=>first.result.current.handleUndo());
  const saved=sessionStorage.getItem('tracker-undo:tour:current-hand');expect(saved).not.toBeNull();
  first.unmount();
  const second=await prepareUndo(body=>undoReceipt(body),false);
  expect(second.result.current.canUndo).toBe(false);
  const writes=mock.invoke.mock.calls.length;
  await act(async()=>{second.result.current.handleDockAction('call');});
  expect(mock.invoke).toHaveBeenCalledTimes(writes);
  expect(sessionStorage.getItem('tracker-undo:tour:current-hand')).toBe(saved);
 });
 it('keeps gross live contributions separate from the action-derived Review pot',async()=>{
  mock.deadBlind=true;mock.resumeDeadBlind=true;
  mock.rpc.mockImplementation(async(name:string,args:any)=>{
   if(name==='get_tracker_hand_input_tables_v4')return {data:{ok:true,tables},error:null};
   if(name==='get_tracker_roster_snapshot_v2')return snapshot(args);
   if(name==='heartbeat_lock')return {data:{status:'success',locked_by:'actor'},error:null};
   return {data:name==='is_club_tracker'?true:{ok:true,locks:[]},error:null};
  });
  const h=renderHook(()=>useStandaloneHandInput('tour'),{wrapper});
  await waitFor(()=>expect(h.result.current.availableTables).toHaveLength(2));
  await act(async()=>h.result.current.handleTableChange('a'));
  await waitFor(()=>expect(h.result.current.handStarted).toBe(true));
  expect(h.result.current.potSize).toBe(100);
  expect(h.result.current.reviewPotBreakdown?.totalPot).toBe(0);
  expect(h.result.current.reviewPotBreakdown?.uncalled).toEqual({player_id:'player-7',amount:100});
  expect(mock.invoke).not.toHaveBeenCalled();
 });
 it.each(['completed','voided','orphan'])('recovers only a completed nonvoid current-session target (%s)',async(kind)=>{
  mock.deadBlind=true;
  mock.previousVoided=kind==='voided';mock.currentOrphan=kind==='orphan';
  mock.rpc.mockImplementation(async(name:string,args:any)=>{
   if(name==='get_tracker_hand_input_tables_v4')return {data:{ok:true,tables},error:null};
   if(name==='get_tracker_roster_snapshot_v2')return snapshot(args);
   return {data:name==='is_club_tracker'?true:name==='get_next_hand_number'?6:{ok:true,locks:[]},error:null};
  });
  const h=renderHook(()=>useStandaloneHandInput('tour'),{wrapper});
  await waitFor(()=>expect(h.result.current.availableTables).toHaveLength(2));
  await act(async()=>h.result.current.handleTableChange('a'));
  expect(h.result.current.handStarted).toBe(false);
  expect(h.result.current.lastHandId).toBe(kind==='completed'?'previous':null);
  await act(async()=>h.result.current.handleTableChange(''));
  expect(h.result.current.lastHandId).toBeNull();
 });
 it.each(['manual','poll'])('does not overwrite a newer live-blind refresh with an older %s response in the same scope',async(kind)=>{
  const intervals=vi.spyOn(globalThis,'setInterval');
  if(kind==='poll'){mock.deadBlind=true;mock.resumeDeadBlind=true;}
  const replies:Array<(value:unknown)=>void>=[];
  mock.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
   if(name==='get_tracker_hand_input_tables_v4')return {data:{ok:true,tables},error:null};
   if(name==='get_tracker_roster_snapshot_v2')return snapshot(args);
   if(name==='heartbeat_lock')return {data:{status:'success',locked_by:'actor'},error:null};
   if(name==='get_tournament_clock')return new Promise(resolve=>replies.push(resolve));
   return {data:name==='is_club_tracker'?true:{ok:true,locks:[]},error:null};
  });
  const h=renderHook(()=>useStandaloneHandInput('tour'),{wrapper});
  await waitFor(()=>expect(h.result.current.availableTables).toHaveLength(2));
  await act(async()=>h.result.current.handleTableChange('a'));
  let first!:Promise<void>,second!:Promise<void>;
  if(kind==='poll')await waitFor(()=>expect(h.result.current.handStarted).toBe(true));
  const poll=intervals.mock.calls.find(([,delay])=>delay===25000)?.[0];
  act(()=>{first=kind==='poll'?(poll as ()=>Promise<void>)():h.result.current.refreshLiveLevel();second=h.result.current.refreshLiveLevel();});
  expect(replies).toHaveLength(2);
  const level=(n:number)=>({data:{current_level:{level_number:n,small_blind:100*n,big_blind:200*n}},error:null});
  await act(async()=>{replies[1](level(2));await second;});
  expect(h.result.current.liveLevelNumber).toBe(2);
  await act(async()=>{replies[0](level(1));await first;});
  expect(h.result.current.liveLevelNumber).toBe(2);
 });
 it.each(['table_change','auth_change','unmount'])('ignores a late live-blind refresh after %s',async(kind)=>{
  let finish!:(value:unknown)=>void;
  mock.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
   if(name==='get_tracker_hand_input_tables_v4')return {data:{ok:true,tables},error:null};
   if(name==='get_tracker_roster_snapshot_v2')return snapshot(args);
   if(name==='get_tournament_clock')return new Promise(resolve=>{finish=resolve;});
   return {data:name==='is_club_tracker'?true:{ok:true,locks:[]},error:null};
  });
  const h=renderHook(()=>useStandaloneHandInput('tour'),{wrapper});
  await waitFor(()=>expect(h.result.current.availableTables).toHaveLength(2));
  await act(async()=>h.result.current.handleTableChange('a'));
  let pending!:Promise<void>;
  act(()=>{pending=h.result.current.refreshLiveLevel();});
  if(kind==='table_change')await act(async()=>h.result.current.handleTableChange('b'));
  else if(kind==='auth_change')await act(async()=>{mock.listeners.forEach(listener=>listener('SIGNED_OUT',null));});
  else h.unmount();
  mock.info.mockClear();mock.error.mockClear();
  await act(async()=>{finish({data:{current_level:{level_number:99,small_blind:100,big_blind:200}},error:null});await pending;});
  expect(h.result.current.liveLevelNumber).not.toBe(99);
  expect(mock.info).not.toHaveBeenCalled();expect(mock.error).not.toHaveBeenCalled();
 });
 it.each(['rpc_error','malformed','throw','timeout','poll_error'])('does not report %s live-blind refresh as success or erase verified level',async(kind)=>{
  const intervals=vi.spyOn(globalThis,'setInterval');
  mock.deadBlind=true;mock.resumeDeadBlind=true;
  let failClock=false;
  let finishClock!:(value:unknown)=>void;
  mock.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
   if(name==='get_tracker_hand_input_tables_v4')return {data:{ok:true,tables},error:null};
   if(name==='get_tracker_roster_snapshot_v2')return snapshot(args);
   if(name==='heartbeat_lock')return {data:{status:'success',locked_by:'actor'},error:null};
   if(name==='get_tournament_clock'){
    if(failClock){
     if(kind==='throw')throw new Error('TEST clock transport');
     if(kind==='timeout')return new Promise(resolve=>{finishClock=resolve;});
     return {data:kind==='malformed'?{current_level:[]}:null,error:['rpc_error','poll_error'].includes(kind)?{message:'503 clock TEST'}:null};
    }
    return {data:{current_level:{level_number:1,small_blind:100,big_blind:100,ante:0}},error:null};
   }
   return {data:name==='is_club_tracker'?true:{ok:true,locks:[]},error:null};
  });
  const h=renderHook(()=>useStandaloneHandInput('tour'),{wrapper});
  await waitFor(()=>expect(h.result.current.availableTables).toHaveLength(2));
  await act(async()=>h.result.current.handleTableChange('a'));
  await waitFor(()=>expect(h.result.current.handStarted).toBe(true));
  await act(async()=>h.result.current.refreshLiveLevel());
  await waitFor(()=>expect(h.result.current.liveLevelNumber).toBe(1));
  failClock=true;
  mock.error.mockClear();mock.info.mockClear();
  try{
   if(kind==='poll_error'){
    const poll=intervals.mock.calls.find(([,delay])=>delay===25000)?.[0];
    expect(typeof poll).toBe('function');
    await act(async()=>{await (poll as ()=>Promise<void>)();});
   }else if(kind==='timeout'){
    vi.useFakeTimers();let pending!:Promise<void>;
    act(()=>{pending=h.result.current.refreshLiveLevel();});
    await act(async()=>{await vi.advanceTimersByTimeAsync(10001);await pending;});
    await act(async()=>finishClock({data:{current_level:{level_number:99,big_blind:999}},error:null}));
   }else await act(async()=>h.result.current.refreshLiveLevel());
   expect(h.result.current.liveLevelNumber).toBe(1);
   expect(mock.info).not.toHaveBeenCalled();
   if(kind!=='poll_error')expect(mock.error).toHaveBeenCalledWith(expect.stringMatching(/blind|clock/i));
  }finally{vi.useRealTimers();}
 });
 it('bounds a hung table-list read and ignores its late response',async()=>{
  const hungRpc='get_tracker_hand_input_tables_v4';
  let finish!:(value:unknown)=>void;const pending=new Promise(resolve=>{finish=resolve;});
  mock.rpc.mockImplementation(async(name:string)=>{
   if(name===hungRpc)return pending;
   if(name==='get_tracker_hand_input_tables_v4')return {data:{ok:true,tables},error:null};
   return {data:name==='is_club_tracker'?true:{ok:true,locks:[]},error:null};
  });
  vi.useFakeTimers();
  try{
   const h=renderHook(()=>useStandaloneHandInput('tour'),{wrapper});
   await act(async()=>{await vi.advanceTimersByTimeAsync(1);});
   expect(mock.rpc.mock.calls.some(([name])=>name===hungRpc)).toBe(true);
   await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});
   expect(h.result.current.tableLoadState).toBe('error');
   expect(h.result.current.availableTables).toEqual([]);
   await act(async()=>finish({data:{ok:true,tables,locks:[]},error:null}));
   expect(h.result.current.tableLoadState).toBe('error');
   expect(mock.invoke).not.toHaveBeenCalled();
  }finally{vi.useRealTimers();}
 });
 it('keeps selected-table context loading until a real empty roster is verified',async()=>{
  let finish!:(value:unknown)=>void;const pending=new Promise(resolve=>{finish=resolve;});
  mock.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
   if(name==='get_tracker_hand_input_tables_v4')return {data:{ok:true,tables},error:null};
   if(name==='get_tracker_roster_snapshot_v2')return pending;
   return {data:name==='is_club_tracker'?true:{ok:true,locks:[]},error:null};
  });
  const h=renderHook(()=>useStandaloneHandInput('tour'),{wrapper});
  await waitFor(()=>expect(h.result.current.availableTables).toHaveLength(2));
  let load!:Promise<void>;act(()=>{load=h.result.current.handleTableChange('a');});
  await waitFor(()=>expect(mock.rpc.mock.calls.some(([name])=>name==='get_tracker_roster_snapshot_v2')).toBe(true));
  expect(h.result.current.tableContextReadState).toBe('loading');
  await act(async()=>{finish(snapshot({p_tournament_table_id:'logical-a',p_table_session_id:'session-a',p_expected_epoch:1}));await load;});
  expect(h.result.current.tableContextReadState).toBe('ready');expect(h.result.current.players).toEqual([]);
 });
 it('explains invalidated roster authority without presenting it as empty or unlocking writes',async()=>{
  mock.rpc.mockImplementation(async(name:string)=>{
   if(name==='get_tracker_hand_input_tables_v4')return {data:{ok:true,tables},error:null};
   if(name==='get_tracker_roster_snapshot_v2')return {data:{ok:false,error:'actor_not_authorized'},error:null};
   return {data:name==='is_club_tracker'?true:{ok:true,locks:[]},error:null};
  });
  const h=renderHook(()=>useStandaloneHandInput('tour'),{wrapper});
  await waitFor(()=>expect(h.result.current.availableTables).toHaveLength(2));
  await act(async()=>h.result.current.handleTableChange('a'));
  expect(h.result.current.tableContextReadState).toBe('error');
  expect(h.result.current.tableSelectionNotice).toContain('Quyền hoặc phiên/chế độ bàn đã thay đổi');
  expect(h.result.current.players).toEqual([]);
  expect(mock.error).not.toHaveBeenCalledWith('Không thể tải danh sách người chơi');
  expect(mock.invoke).not.toHaveBeenCalled();
 });
 it('keeps an unavailable roster distinct from an authoritative empty table',async()=>{
  mock.rpc.mockImplementation(async(name:string)=>{
   if(name==='get_tracker_hand_input_tables_v4')return {data:{ok:true,tables},error:null};
   if(name==='get_tracker_roster_snapshot_v2')return {data:null,error:{message:'LOCAL 503'}};
   return {data:name==='is_club_tracker'?true:{ok:true,locks:[]},error:null};
  });
  const h=renderHook(()=>useStandaloneHandInput('tour'),{wrapper});
  await waitFor(()=>expect(h.result.current.availableTables).toHaveLength(2));
  await act(async()=>h.result.current.handleTableChange('a'));
  expect(h.result.current.tableContextReadState).toBe('error');
  expect(mock.error).toHaveBeenCalledWith('Không thể tải danh sách người chơi');
 });
 it('ends a hung roster read without a late response reviving its context',async()=>{
  let finish!:(value:unknown)=>void;const pending=new Promise(resolve=>{finish=resolve;});
  mock.rpc.mockImplementation(async(name:string)=>{
   if(name==='get_tracker_hand_input_tables_v4')return {data:{ok:true,tables},error:null};
   if(name==='get_tracker_roster_snapshot_v2')return pending;
   return {data:name==='is_club_tracker'?true:{ok:true,locks:[]},error:null};
  });
  const h=renderHook(()=>useStandaloneHandInput('tour'),{wrapper});
  await waitFor(()=>expect(h.result.current.availableTables).toHaveLength(2));
  vi.useFakeTimers();
  try{
   let load!:Promise<void>;await act(async()=>{load=h.result.current.handleTableChange('a');});
   expect(h.result.current.tableContextReadState).toBe('loading');
   await act(async()=>{await vi.advanceTimersByTimeAsync(10001);await load;});
   expect(h.result.current.tableContextReadState).toBe('error');
   await act(async()=>finish(snapshot({p_tournament_table_id:'logical-a',p_table_session_id:'session-a',p_expected_epoch:1})));
   expect(h.result.current.tableContextReadState).toBe('error');expect(mock.invoke).not.toHaveBeenCalled();
  }finally{vi.useRealTimers();}
 });
 it('ends a hung next-hand identity read instead of leaving operational loading forever',async()=>{
  mock.staleOrphan=true;
  let finish!:(value:unknown)=>void;const pending=new Promise(resolve=>{finish=resolve;});
  mock.rpc.mockImplementation(async(name:string,args:any)=>{
   if(name==='get_tracker_hand_input_tables_v4')return {data:{ok:true,tables},error:null};
   if(name==='get_tracker_roster_snapshot_v2')return snapshot(args);
   if(name==='get_next_hand_number')return pending;
   return {data:name==='is_club_tracker'?true:{ok:true,locks:[]},error:null};
  });
  const h=renderHook(()=>useStandaloneHandInput('tour'),{wrapper});
  await waitFor(()=>expect(h.result.current.availableTables).toHaveLength(2));
  vi.useFakeTimers();
  try{
   let load!:Promise<void>;await act(async()=>{load=h.result.current.handleTableChange('a');});
   expect(mock.rpc.mock.calls.some(([name])=>name==='get_next_hand_number')).toBe(true);
   expect(h.result.current.tableContextReadState).toBe('loading');
   await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});
   expect(h.result.current.tableContextReadState).toBe('error');
   await load;
   await act(async()=>finish({data:99,error:null}));
   expect(h.result.current.tableContextReadState).toBe('error');
   expect(mock.invoke).not.toHaveBeenCalled();
  }finally{vi.useRealTimers();}
 });
 it('does not repopulate a table after the operator backs out during its read',async()=>{
  let finish!:(value:unknown)=>void;const pending=new Promise(resolve=>{finish=resolve;});
  mock.rpc.mockImplementation(async(name:string)=>{
   if(name==='get_tracker_hand_input_tables_v4')return {data:{ok:true,tables},error:null};
   if(name==='get_tracker_roster_snapshot_v2')return pending;
   return {data:name==='is_club_tracker'?true:name==='get_next_hand_number'?2:{ok:true,locks:[]},error:null};
  });
  const h=renderHook(()=>useStandaloneHandInput('tour'),{wrapper});
  await waitFor(()=>expect(h.result.current.availableTables).toHaveLength(2));
  let load!:Promise<void>;await act(async()=>{load=h.result.current.handleTableChange('a');});
  act(()=>h.result.current.backToTableMap());
  const response=snapshot({p_tournament_table_id:'logical-a',p_table_session_id:'session-a',p_expected_epoch:1});
  response.data.seats[0].seat={player_id:'late-player',entry_number:1,seat_number:1,chip_count:20000,player_name:'LATE PRIVATE PLAYER'};
  await act(async()=>{finish(response);await load;});
  expect(h.result.current.tableId).toBe('');expect(h.result.current.tableContextReadState).toBe('idle');
  expect(h.result.current.players).toEqual([]);expect(h.result.current.orphanHand).toBeNull();expect(mock.invoke).not.toHaveBeenCalled();
 });
 it.each([false,true])('warns about missing next-hand button only outside resume=%s',async(resume)=>{
  mock.deadBlind=true;mock.lineageMissing=true;mock.resumeDeadBlind=resume;
  mock.rpc.mockImplementation(async(name:string,args:any)=>{
   if(name==='get_tracker_hand_input_tables_v4')return {data:{ok:true,tables},error:null};
   if(name==='get_tracker_roster_snapshot_v2')return snapshot(args);
   return {data:name==='is_club_tracker'?true:name==='get_next_hand_number'?6:{ok:true,locks:[]},error:null};
  });
  const h=renderHook(()=>useStandaloneHandInput('tour'),{wrapper});
  await waitFor(()=>expect(h.result.current.availableTables).toHaveLength(2));
  await act(async()=>h.result.current.handleTableChange('a'));
  const warning='Không đủ vị trí blind của hand trước để gợi ý BTN. Hãy chọn BTN thủ công.';
  if(resume)expect(mock.warning).not.toHaveBeenCalledWith(warning);
  else expect(mock.warning).toHaveBeenCalledWith(warning);
  h.unmount();
 });
 it('offers server reload recovery when start fails without unlocking another start',async()=>{
  mock.deadBlind=true;
  mock.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
   if(name==='get_tracker_hand_input_tables_v4')return {data:{ok:true,tables},error:null};
   if(name==='get_tracker_roster_snapshot_v2')return snapshot(args);
   return {data:name==='is_club_tracker'?true:name==='get_next_hand_number'?1:{ok:true,locks:[]},error:null};
  });
  mock.invoke.mockResolvedValue({data:{status:'error',error:'tracker_floor_blind_level_unavailable'},error:null});
  const h=renderHook(()=>useStandaloneHandInput('tour'),{wrapper});
  await waitFor(()=>expect(h.result.current.availableTables).toHaveLength(2));
  await act(async()=>h.result.current.handleTableChange('a'));
  await waitFor(()=>expect(h.result.current.players).toHaveLength(6));
  await act(async()=>h.result.current.handleStartHand());
  expect(h.result.current.handStarted).toBe(false);
  expect(h.result.current.actionSyncBlocked).toBe(true);
  expect(h.result.current.syncPhase).toBe('uncertain');
  expect(h.result.current.submitting).toBe(false);
 });
 it.each(['missing_sb','conflicting_bb'])('fails closed when frozen resume blind evidence is %s',async(kind)=>{
  mock.deadBlind=true;mock.resumeDeadBlind=true;
  if(kind==='missing_sb')mock.resumeSb=null;else mock.resumeBb=8;
  mock.rpc.mockImplementation(async(name:string,args:any)=>{
   if(name==='get_tracker_hand_input_tables_v4')return {data:{ok:true,tables},error:null};
   if(name==='get_tracker_roster_snapshot_v2')return snapshot(args);
   return {data:name==='is_club_tracker'?true:{ok:true,locks:[]},error:null};
  });
  const h=renderHook(()=>useStandaloneHandInput('tour'),{wrapper});
  await waitFor(()=>expect(h.result.current.availableTables).toHaveLength(2));
  await act(async()=>h.result.current.handleTableChange('a'));
  await waitFor(()=>expect(mock.error).toHaveBeenCalled());
  expect(mock.error.mock.calls.some(([text])=>String(text).includes('vị trí blind đã lưu'))).toBe(true);
  expect(h.result.current.handStarted).toBe(false);expect(mock.invoke).not.toHaveBeenCalled();
 });
 it.each(['tracker_action_stack_exceeded','tracker_action_negative_amount','tracker_action_stack_evidence_missing'])(
  'keeps a confirmed %s rejection out of unknown-commit recovery',async(code)=>{
  mock.deadBlind=true;mock.resumeDeadBlind=true;
  mock.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
   if(name==='get_tracker_hand_input_tables_v4')return {data:{ok:true,tables},error:null};
   if(name==='get_tracker_roster_snapshot_v2')return snapshot(args);
   if(name==='heartbeat_lock')return {data:{status:'success',locked_by:'actor'},error:null};
   return {data:name==='is_club_tracker'?true:{ok:true,locks:[]},error:null};
  });
  mock.invoke.mockResolvedValue({data:null,error:{message:'Edge returned409',context:{json:async()=>({error:code,code})}}});
  const h=renderHook(()=>useStandaloneHandInput('tour'),{wrapper});
  await waitFor(()=>expect(h.result.current.availableTables).toHaveLength(2));
  await act(async()=>h.result.current.handleTableChange('a'));
  await waitFor(()=>expect(h.result.current.handStarted).toBe(true));
  const initialActions=h.result.current.actions,initialPlayers=h.result.current.players;
  mock.error.mockClear();act(()=>h.result.current.handleDockAction('call'));
  await waitFor(()=>expect(mock.invoke).toHaveBeenCalledOnce());
  await waitFor(()=>expect(h.result.current.syncPhase).toBe('error'));
  expect(h.result.current.syncLabel).toMatch(/stack|Số chip/);
  expect(h.result.current.actionSyncBlocked).toBe(false);expect(h.result.current.submitting).toBe(false);
  expect(h.result.current.actions).toEqual(initialActions);expect(h.result.current.players).toEqual(initialPlayers);
  expect(mock.error).toHaveBeenCalledWith(expect.stringMatching(/stack|Số chip/),{description:`Mã lỗi: ${code}`});
 });
 it('restores current-hand frozen dead SB/BB positions instead of recomputing raw seats',async()=>{
  mock.deadBlind=true;mock.resumeDeadBlind=true;
  mock.rpc.mockImplementation(async(name:string,args:any)=>{
   if(name==='get_tracker_hand_input_tables_v4')return {data:{ok:true,tables},error:null};
   if(name==='get_tracker_roster_snapshot_v2')return snapshot(args);
   if(name==='heartbeat_lock')return {data:{status:'success',locked_by:'actor'},error:null};
   return {data:name==='is_club_tracker'?true:{ok:true,locks:[]},error:null};
  });
  const h=renderHook(()=>useStandaloneHandInput('tour'),{wrapper});
  await waitFor(()=>expect(h.result.current.availableTables).toHaveLength(2));
  await act(async()=>h.result.current.handleTableChange('a'));
  await waitFor(()=>expect(h.result.current.handStarted).toBe(true));
  expect(h.result.current.blindBbSeat).toBe(7);expect(h.result.current.blindSbSeat).toBeNull();
  expect(h.result.current.deadSb).toBe(true);expect(h.result.current.bbPosted).toBe(true);
  expect(h.result.current.positionsBySeat.get(8)).toBe('UTG');
  expect(h.result.current.positionsBySeat.get(7)).toBe('BB');
  expect(h.result.current.showBlindSetup).toBe(false);expect(mock.invoke).not.toHaveBeenCalled();
 });
 it.each(['derived','manual'])('accepts automatic dead SB after BB receipt (%s)',async(mode)=>{
  mock.deadBlind=true;
  mock.rpc.mockImplementation(async(name:string,args:any)=>{
   if(name==='get_tracker_hand_input_tables_v4')return {data:{ok:true,tables},error:null};
   if(name==='get_tracker_roster_snapshot_v2')return snapshot(args);
   if(name==='heartbeat_lock')return {data:{status:'success',locked_by:'actor'},error:null};
   return {data:name==='is_club_tracker'?true:name==='get_next_hand_number'?5:{ok:true,locks:[]},error:null};
  });
  mock.invoke.mockResolvedValue({data:{status:'success',data:{status:'success',hand_id:'hand-new'}},error:null});
  const h=renderHook(()=>useStandaloneHandInput('tour'),{wrapper});
  await waitFor(()=>expect(h.result.current.availableTables).toHaveLength(2));
  await act(async()=>h.result.current.handleTableChange('a'));
  await waitFor(()=>expect(h.result.current.players).toHaveLength(6));
  expect(h.result.current.deadSb).toBe(true);expect(h.result.current.blindBbSeat).toBe(7);
  expect(h.result.current.positionsBySeat.get(8)).toBe('UTG');
  expect(h.result.current.positionsBySeat.get(7)).toBe('BB');
  await act(async()=>h.result.current.handleStartHand());expect(h.result.current.handStarted).toBe(true);
  act(()=>h.result.current.handlePostBlind('post_bb','player-7',100));
  await waitFor(()=>expect(h.result.current.bbPosted).toBe(true));expect(h.result.current.sbPosted).toBe(false);
  mock.error.mockClear();if(mode==='manual')act(()=>h.result.current.handleConfirmBlinds());
  expect(h.result.current.blindsConfirmed).toBe(true);expect(h.result.current.showBlindSetup).toBe(false);
  expect(mock.error).not.toHaveBeenCalled();
 });
 it.each([true,false])('receipt recovery releases busy state; exact proof=%s',async(validProof)=>{
  const id=(n:number)=>`b1800000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const actor=id(1),tour=id(2),logical=id(3),hand=id(4),session=id(5),physical=id(7);
  const intent={actor_id:actor,tournament_id:tour,tournament_table_id:logical,hand_id:hand,
   table_session_id:session,control_epoch:1,source_revision:1,request_id:id(6),
   payload:{hand_time:'2026-10-18T00:00:00Z',players:[{player_id:id(8),starting_stack:20000,ending_stack:20000}],actions:[],side_pots:[],community_cards:[],pot_size:0}};
  const key=`vinpoker:manual-finish:${actor}:${tour}:${logical}:${hand}`;
  sessionStorage.setItem(key,JSON.stringify(intent));
  mock.getUser.mockResolvedValue({data:{user:{id:actor}},error:null});
  mock.rpc.mockImplementation(async(name:string,args:any)=>{
   if(name==='get_tracker_hand_input_tables_v4')return {data:{ok:true,tables:[{...tables[0],table_id:physical,tournament_table_id:logical,table_session_id:session}]},error:null};
   if(name==='get_tracker_roster_snapshot_v2')return snapshot(args);
   return {data:name==='is_club_tracker'?true:name==='get_next_hand_number'?3:{ok:true,locks:[]},error:null};
  });
  mock.invoke.mockResolvedValue({data:{status:'success',data:{ok:true,status:'success',hand_id:hand,actor_id:actor,
   request_id:validProof?intent.request_id:id(99),intent,table_session_id:session,control_epoch:1,expected_source_revision:1,
   committed_source_revision:2,starting_total:20000,ending_total:20000}},error:null});
  const h=renderHook(()=>useStandaloneHandInput(tour),{wrapper});
  await waitFor(()=>expect(h.result.current.availableTables).toHaveLength(1));
  await act(async()=>h.result.current.handleTableChange(physical));
  await waitFor(()=>expect(h.result.current.pendingFinish?.request_id).toBe(intent.request_id));
  expect(sessionStorage.getItem(key)).toBeNull(); // Legacy journal was adopted, not discarded.
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual(intent);
  await act(async()=>h.result.current.handleReconcilePendingFinish());
  expect(mock.invoke).toHaveBeenCalledOnce();
  expect(mock.invoke.mock.calls[0][1].body.action).toBe('get_manual_finish_receipt_v1');
  if(validProof){expect(localStorage.getItem(key)).toBeNull();expect(h.result.current.pendingFinish).toBeNull();}
  else{expect(JSON.parse(localStorage.getItem(key)!)).toEqual(intent);expect(h.result.current.pendingFinish?.request_id).toBe(intent.request_id);}
  expect(h.result.current.submitting).toBe(false);
 });
 it("ignores initial getUser finishing after a newer signed-in event",async()=>{
  let finish!:(value:unknown)=>void;mock.getUser.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));
  mock.rpc.mockImplementation(async(name:string)=>name==='is_club_tracker'?{data:true,error:null}:{data:{ok:true,tables,locks:[]},error:null});
  const h=renderHook(()=>useStandaloneHandInput('tour'),{wrapper});
  act(()=>{for(const listener of [...mock.listeners])listener('SIGNED_IN',{user:{id:'actor'}});});
  await waitFor(()=>expect(h.result.current.startCapability).toBe('allowed'));
  await act(async()=>finish({data:{user:null},error:{message:'expired old token'}}));
  expect(h.result.current.startCapability).toBe('allowed');
 });
 it("revalidates failed Start authority after the same user signs in again", async () => {
  let failing=true;
  mock.rpc.mockImplementation(async(name:string)=>name==='is_club_tracker'
   ?{data:failing?null:true,error:failing?{message:'503 authority'}:null}
   :{data:{ok:true,tables,locks:[]},error:null});
  const h=renderHook(()=>useStandaloneHandInput('tour'),{wrapper});
  await waitFor(()=>expect(h.result.current.startCapability).toBe('error'));
  failing=false;
  act(()=>{for(const listener of [...mock.listeners])listener('SIGNED_IN',{user:{id:'actor'}});});
  await waitFor(()=>expect(h.result.current.startCapability).toBe('allowed'));
 });
 it("reports scoped API failure without falling back to legacy authority", async () => {
  mock.rpc.mockImplementation(async (name: string) => ({
   data: null, error: name === "get_tracker_hand_input_tables_v4" ? { message: "RPC unavailable" } : null,
  }));
  const h = renderHook(() => useStandaloneHandInput("tour"), { wrapper });
  await waitFor(() => expect(h.result.current.tableLoadState).toBe("error"));
  expect(h.result.current.availableTables).toHaveLength(0);
  expect(h.result.current.tableLoadError).toBeTruthy();
  expect(mock.rpc.mock.calls.some(([name]) => name === "get_tracker_hand_input_tables_v3"
   || name === "get_tracker_roster_snapshot_v1")).toBe(false);
 });
 it("does not offer an in-progress hand from an older incarnation of the same table", async () => {
  mock.staleOrphan = true;
  mock.rpc.mockImplementation(async (name: string, args: any) => {
   if (name === "get_tracker_hand_input_tables_v4") return { data: { ok: true, tables }, error: null };
   if (name === "get_tracker_roster_snapshot_v2") return snapshot(args);
   return { data: name === "get_next_hand_number" ? 1 : { ok: true, locks: [] }, error: null };
  });
  const h = renderHook(() => useStandaloneHandInput("tour"), { wrapper });
  await waitFor(() => expect(h.result.current.availableTables).toHaveLength(2));
  await act(async () => { await h.result.current.handleTableChange("a"); });
  expect(h.result.current.orphanHand).toBeNull();
 expect(mock.rpc.mock.calls.some(([name]) => name === "get_next_hand_number")).toBe(true);
 });
 it("retains a resumable hand from the verified current session", async () => {
  mock.currentOrphan = true;
  mock.rpc.mockImplementation(async (name: string, args: any) => {
   if (name === "get_tracker_hand_input_tables_v4") return { data: { ok: true, tables }, error: null };
   if (name === "get_tracker_roster_snapshot_v2") return snapshot(args);
   return { data: name === "get_next_hand_number" ? 1 : { ok: true, locks: [] }, error: null };
  });
  const h = renderHook(() => useStandaloneHandInput("tour"), { wrapper });
  await waitFor(() => expect(h.result.current.availableTables).toHaveLength(2));
  await act(async () => { await h.result.current.handleTableChange("a"); });
  expect(h.result.current.orphanHand).toEqual({ id: "current-session-hand", hand_number: 2 });
  expect(mock.rpc.mock.calls.some(([name]) => name === "get_next_hand_number")).toBe(false);
  mock.resumeReads.length = 0;
  await act(async () => { expect(await h.result.current.handleContinueOrphan({ silent: true })).toBe(false); });
  expect(mock.resumeReads).toEqual([{ id: "current-session-hand", tournament_id: "tour",
   table_id: "logical-a", table_session_id: "session-a", status: "in_progress" }]);
  expect(mock.rpc.mock.calls.some(([name]) => name === "heartbeat_lock" || name === "takeover_hand_lock")).toBe(false);
 });
 it("does not merge an old confirmed receipt over a newer canonical stack", async () => {
  let snapshots = 0;
  mock.rpc.mockImplementation(async (name: string, args: any) => {
   if (name === "get_tracker_hand_input_tables_v4") return { data: { ok: true, tables }, error: null };
   if (name === "get_tracker_roster_snapshot_v2") {
    const r = snapshot(args); snapshots++;
    if (snapshots > 1) r.data.seats[0] = { seat_number: 1, token: "newer25k",
     seat: { player_id: "player", entry_number: 1, seat_number: 1, chip_count: 25000, player_name: "TEST" } };
    return r;
   }
   if (name === "set_tracker_table_roster_seat_v2") return { data: { ok: true, seat_token: "old20k",
    tournament_table_id: args.p_tournament_table_id, table_session_id: args.p_table_session_id, control_epoch: args.p_expected_epoch,
    seat: { id: "seat", entry_id: "entry", player_id: "player", entry_number: 1, seat_number: 1, chip_count: 20000 } }, error: null };
   return { data: name === "get_next_hand_number" ? 1 : { ok: true, locks: [] }, error: null };
  });
  const h = renderHook(() => useStandaloneHandInput("tour"), { wrapper });
  await waitFor(() => expect(h.result.current.availableTables).toHaveLength(2));
  await act(async () => { await h.result.current.handleTableChange("a"); });
  await act(async () => { expect(await h.result.current.handleSetRosterSeat({ seatNumber: 1, playerName: "TEST", chipCount: 20000 }))
   .toEqual({ ok: true, error: "roster_refresh_required" }); });
  expect(h.result.current.players).toHaveLength(0);
  expect(mock.rpc.mock.calls.filter(([name]) => name === "set_tracker_table_roster_seat_v2")).toHaveLength(1);
  expect(sessionStorage.length).toBe(0);
 });
 it("drops old A completion after A→B→A and sends only one simultaneous write", async () => {
  let release!: (value: any) => void;
  let sent: any;
  mock.rpc.mockImplementation((name: string, args: any) => {
   if (name === "get_tracker_roster_snapshot_v2") return Promise.resolve(snapshot(args));
   if (name === "get_tracker_hand_input_tables_v4") return Promise.resolve({ data: { ok: true, tables }, error: null });
   if (name === "set_tracker_table_roster_seat_v2") {
    sent = args;
    return new Promise(resolve => { release = resolve; });
   }
   return Promise.resolve({ data: name === "get_next_hand_number" ? 1 : { ok: true, locks: [] }, error: null });
  });
  const h = renderHook(() => useStandaloneHandInput("tour"), { wrapper });
  await waitFor(() => expect(h.result.current.availableTables).toHaveLength(2));
  await act(async () => { await h.result.current.handleTableChange("a"); });
  const args = { seatNumber: 1, playerName: "TEST", chipCount: 20000 };
  let pending!: ReturnType<typeof h.result.current.handleSetRosterSeat>;
  act(() => { pending = h.result.current.handleSetRosterSeat(args); });
  await act(async () => {
   expect((await h.result.current.handleSetRosterSeat(args)).error).toBe("roster_write_in_flight");
   await h.result.current.handleTableChange("b");
  });
  await act(async () => { await h.result.current.handleTableChange("a"); });
  await act(async () => {
   release({ data: { ok: true, seat_token: "empty", tournament_table_id: sent.p_tournament_table_id,
    table_session_id: sent.p_table_session_id, control_epoch: sent.p_expected_epoch,
    seat: { id: "seat", entry_id: "entry", player_id: "player", entry_number: 1,
     seat_number: 1, chip_count: 20000 } }, error: null });
   expect((await pending).error).toBe("stale_roster_context");
  });
  expect(mock.rpc.mock.calls.filter(([name]) => name === "set_tracker_table_roster_seat_v2")).toHaveLength(1);
  expect(h.result.current.players).toHaveLength(0);
 });
 it.each([false, true])("keeps unknown key across remount; changed epoch=%s reconciles before any new mutation", async (changedEpoch) => {
  let first = true;
  let epoch = 1;
  mock.rpc.mockImplementation(async (name: string, args: any) => {
   if (name === "get_tracker_roster_snapshot_v2") return snapshot(args);
   if (name === "get_tracker_hand_input_tables_v4") return { data: { ok: true, tables: tables.map(t => ({ ...t, control_epoch: epoch })) }, error: null };
   if (name === "set_tracker_table_roster_seat_v2") {
    if (first) { first = false; return { data: null, error: { message: "response lost" } }; }
    return { data: { ok: true, seat_token: "empty", tournament_table_id: args.p_tournament_table_id,
     table_session_id: args.p_table_session_id, control_epoch: args.p_expected_epoch,
     seat: { id: "seat", entry_id: "entry", player_id: "player", entry_number: 1,
      seat_number: args.p_seat_number, chip_count: args.p_chip_count, player_name: args.p_player_name } }, error: null };
   }
   return { data: name === "get_next_hand_number" ? 1 : { ok: true, locks: [] }, error: null };
  });
  let h = renderHook(() => useStandaloneHandInput("tour"), { wrapper });
  await waitFor(() => expect(h.result.current.availableTables).toHaveLength(2));
  await act(async () => { await h.result.current.handleTableChange("a"); });
  const args = { seatNumber: 1, playerName: "TEST", chipCount: 20000 };
  await act(async () => { expect((await h.result.current.handleSetRosterSeat(args)).ok).toBe(false); });
  expect(h.result.current.players).toHaveLength(0);
  h.unmount();
  if (changedEpoch) epoch = 2;
  h = renderHook(() => useStandaloneHandInput("tour"), { wrapper });
  await waitFor(() => expect(h.result.current.availableTables).toHaveLength(2));
  await act(async () => { await h.result.current.handleTableChange("a"); });
  await act(async () => {
   const result = await h.result.current.handleSetRosterSeat(args);
   if (changedEpoch) expect(result.error).toBe("previous_intent_resolved");
   else expect(result.ok).toBe(true);
  });
  const writes = mock.rpc.mock.calls.filter(([name]) => name === "set_tracker_table_roster_seat_v2");
  expect(writes).toHaveLength(2);
  expect(writes[0][1].p_request_id).toBe(writes[1][1].p_request_id);
  expect(writes[0][1].p_table_session_id).toBe("session-a");
  expect(writes[1][1].p_expected_epoch).toBe(1);
  if (changedEpoch) expect(h.result.current.players).toHaveLength(0);
  else expect(h.result.current.players[0].current_stack).toBe(20000);
 });
});
