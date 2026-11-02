import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
const h=vi.hoisted(()=>({rpc:vi.fn(),session:{access_token:'TEST_ONLY'},actor:'00000000-0000-4000-8000-000000000040'}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:h.actor},session:h.session})}));
vi.mock('./MultiDayD2ContinuePanel',()=>({MultiDayD2ContinuePanel:({onContinued}:{onContinued?:()=>void})=><button onClick={onContinued}>Verified Continue TEST</button>}));
vi.mock('@/integrations/supabase/SupabaseClientContext',()=>({useSupabaseClient:()=>client}));
const client={rpc:h.rpc};
import {MultiDayInitialDrawPanel} from './MultiDayInitialDrawPanel';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const hash='a'.repeat(32);
const player={participationId:id(2),playerId:id(3),name:'D2 người TEST',stack:20000,seedRevision:0,state:'UNSEATED',
 blocker:null,entryId:null,seatId:null,sourceBags:[{bagId:id(4),bagVersion:1,sourceEntryId:id(5),flightId:id(6),stack:20000}]};
const table={tournamentTableId:id(7),physicalTableId:id(8),tableSessionId:id(9),tableNumber:7,capacity:9,revision:1,epoch:1,occupiedSeats:[],lockedSeats:[],blocker:null};
const roster={eventId:id(1),finalTournamentId:id(10),qualificationHash:hash,sourceHash:hash,releaseEnabled:true,players:[player],tables:[table]};
const assignment={participationId:id(2),playerId:id(3),name:player.name,stack:20000,seedRevision:0,
 tournamentTableId:id(7),physicalTableId:id(8),tableSessionId:id(9),tableNumber:7,seatNumber:1,requestId:id(11)};
const plan={ok:true,state:'PLANNED',planId:id(12),eventId:id(1),finalTournamentId:id(10),sourceHash:hash,selectedTables:[table],assignments:[assignment],idempotent:false};
beforeEach(()=>{
 sessionStorage.clear();h.rpc.mockReset();h.actor=id(40);let n=50;
 vi.stubGlobal('crypto',{randomUUID:()=>id(n++)});
 h.rpc.mockImplementation(async(name:string)=>({data:name==='multi_day_final_roster_v1'?roster:plan,error:null}));
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
async function preview(){fireEvent.click(await screen.findByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Xem phương án D2'}));await screen.findByRole('button',{name:'Xác nhận xếp D2'});}
describe('initial D2 actual component (modeled transport, not E2E)',()=>{
 it('shows a held proposal separately from the seed already used, without a write action',async()=>{
  h.rpc.mockResolvedValue({data:{...roster,players:[{...player,state:'SEATED',entryId:id(20),seatId:id(21)}],heldSeedAdjustments:[{
   requestId:id(30),participationId:player.participationId,playerId:player.playerId,entryId:id(20),seatId:id(21),priorSeedStack:20000,proposedSeedStack:21000,deltaChips:1000,seedRevision:0,status:'OWNER_APPROVED_HELD',liveStackChanged:false,createdAt:'2026-10-25T00:00:00Z'}]},error:null});
  render(<MultiDayInitialDrawPanel eventId={id(1)}/>);
  expect(await screen.findByText('Điều chỉnh seed đang giữ — chưa áp dụng')).toBeInTheDocument();
  expect(screen.getByText(/Seed đã dùng: 20.000 chip · Đề xuất: 21.000 chip/)).toBeInTheDocument();
  expect(screen.getByText('Chưa thay đổi stack đang chơi.')).toBeInTheDocument();
  expect(h.rpc.mock.calls.map(([name])=>name)).toEqual(['multi_day_final_roster_v1']);
 });
 it('does not treat a missing held-adjustment read contract as verified empty',async()=>{
  h.rpc.mockResolvedValue({data:{...roster,players:[{...player,state:'SEATED',entryId:id(20),seatId:id(21)}]},error:null});
  render(<MultiDayInitialDrawPanel eventId={id(1)}/>);
  expect(await screen.findByText('Chưa xác minh được danh sách điều chỉnh seed đang giữ trên backend này.')).toBeInTheDocument();
 });
 it('accepts a verified empty held-adjustment list without claiming backend unavailable',async()=>{
  h.rpc.mockResolvedValue({data:{...roster,players:[{...player,state:'SEATED',entryId:id(20),seatId:id(21)}],heldSeedAdjustments:[]},error:null});
  render(<MultiDayInitialDrawPanel eventId={id(1)}/>);
  await screen.findByText(/Stack mang vào D2: 20.000/);
  expect(screen.queryByText('Chưa xác minh được danh sách điều chỉnh seed đang giữ trên backend này.')).not.toBeInTheDocument();
  expect(screen.queryByText('Điều chỉnh seed đang giữ — chưa áp dụng')).not.toBeInTheDocument();
 });
 it('reads archived initial seats on a fresh mount even when current tables are closed',async()=>{
  h.rpc.mockResolvedValue({data:{...roster,players:[{...player,state:'SEATED',entryId:id(20),seatId:id(21)}],
   tables:[{...table,blocker:'table_requires_review'}],initialDraws:[{planId:id(12),eventId:id(1),finalTournamentId:id(10),
    appliedAt:'2026-10-17T00:00:00Z',assignments:[assignment]}]},error:null});
  render(<MultiDayInitialDrawPanel eventId={id(1)}/>);
  await screen.findByText(/D2 người TEST → Bàn 7, ghế 1/);
  expect(screen.getByText('Ghế D2 ban đầu đã lưu')).toBeInTheDocument();
  expect(screen.queryByRole('group',{name:'Chọn bàn đang mở cho D2'})).not.toBeInTheDocument();
  expect(screen.queryByText(/table_requires_review/)).not.toBeInTheDocument();
  expect(screen.getByText(/Toàn bộ người qualified đã có receipt xếp ghế D2 ban đầu/)).toBeInTheDocument();
  expect(sessionStorage.length).toBe(0);
  expect(h.rpc.mock.calls.map(([name])=>name)).toEqual(['multi_day_final_roster_v1']);
 });
 it('keeps unresolved seating visible when saved receipts cover only part of the qualified list',async()=>{
  h.rpc.mockResolvedValue({data:{...roster,players:[{...player,state:'SEATED',entryId:id(20),seatId:id(21)},
   {...player,participationId:id(30),playerId:id(31),name:'D2 chưa xếp TEST'}],
   initialDraws:[{planId:id(12),eventId:id(1),finalTournamentId:id(10),appliedAt:'2026-10-17T00:00:00Z',assignments:[assignment]}]},error:null});
  render(<MultiDayInitialDrawPanel eventId={id(1)}/>);
  await screen.findByText(/D2 chưa xếp TEST/);
  expect(screen.getByRole('group',{name:'Chọn bàn đang mở cho D2'})).toBeInTheDocument();
  expect(screen.queryByText(/Toàn bộ người qualified đã có receipt/)).not.toBeInTheDocument();
 });
 it('keeps pending receipt recovery even when the refreshed roster has saved initial seating',async()=>{
  sessionStorage.setItem(`vinpoker:d2-initial:v1:${id(40)}:${id(1)}`,JSON.stringify({actorId:id(40),eventId:id(1),requestId:id(50),selectedIds:[table.tournamentTableId],roster,plan,applyRequestId:id(60)}));
  h.rpc.mockResolvedValue({data:{...roster,players:[{...player,state:'SEATED',entryId:id(20),seatId:id(21)}],
   initialDraws:[{planId:id(12),eventId:id(1),finalTournamentId:id(10),appliedAt:'2026-10-17T00:00:00Z',assignments:[assignment]}]},error:null});
  render(<MultiDayInitialDrawPanel eventId={id(1)}/>);
  await screen.findByText(/Ghế D2 ban đầu đã lưu/);
  expect(screen.getByRole('button',{name:'Kiểm tra receipt D2'})).toBeInTheDocument();
  expect(sessionStorage.length).toBe(1);
  expect(h.rpc.mock.calls.map(([name])=>name)).toEqual(['multi_day_final_roster_v1']);
 });
 it('labels saved initial seating and carry stack without implying the player is still seated now',async()=>{
  h.rpc.mockResolvedValue({data:{...roster,players:[{...player,state:'SEATED',entryId:id(20),seatId:id(21)}]},error:null});
  render(<MultiDayInitialDrawPanel eventId={id(1)}/>);
  await screen.findByText(/Đã xếp ghế D2 ban đầu/);
  expect(screen.getByText(/Stack mang vào D2: 20.000 chip/)).toBeInTheDocument();
  expect(screen.getByText(/không phải stack hoặc ghế hiện tại/)).toBeInTheDocument();
  expect(screen.queryByText(/\bSEATED\b/)).not.toBeInTheDocument();
  expect(screen.queryByText(/chưa ngồi/)).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Xem phương án D2'})).toBeDisabled();
  expect(h.rpc.mock.calls.map(([name])=>name)).toEqual(['multi_day_final_roster_v1']);
 });
 it('refreshes canonical table state after child Continue succeeds',async()=>{
  h.rpc.mockResolvedValueOnce({data:{...roster,tables:[{...table,blocker:'redraw_hold'}]},error:null})
   .mockResolvedValue({data:roster,error:null});
  render(<MultiDayInitialDrawPanel eventId={id(1)}/>);
  await screen.findByText(/redraw_hold/);
  fireEvent.click(screen.getByRole('button',{name:'Verified Continue TEST'}));
  await waitFor(()=>expect(screen.queryByText(/redraw_hold/)).toBeNull());
  expect(h.rpc.mock.calls.filter(([name])=>name==='multi_day_final_roster_v1')).toHaveLength(2);
 });
 it('shows qualified roster and exact saved table/seat preview before confirmation',async()=>{
  render(<MultiDayInitialDrawPanel eventId={id(1)}/>);await preview();
  expect(screen.getByText(/D2 người TEST → Bàn 7, ghế 1/)).toBeTruthy();
  expect(h.rpc).toHaveBeenCalledWith('multi_day_plan_initial_draw_v1',expect.objectContaining({p_event_id:id(1),p_tournament_table_ids:[id(7)],p_expected_source_hash:hash}));
  expect(h.rpc.mock.calls.some(([name])=>name==='multi_day_apply_initial_draw_v1')).toBe(false);
 });
 it('keeps apply key after lost response and reload recovers using receipt READ only',async()=>{
  let application:unknown=null;
  h.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
   if(name==='multi_day_apply_initial_draw_v1'){
    application={...plan,state:'APPLIED',requestId:args.p_request_id,appliedAt:'2026-10-17T00:00:00Z',seatReceipts:[{
     ok:true,state:'SEATED',eventId:id(1),finalTournamentId:id(10),playerId:id(3),participationId:id(2),
     entryId:id(20),seatId:id(21),receiptId:id(22),seedStack:20000,seedRevision:0,newBuyInVnd:0,denominationIssuance:'NONE'}]};
    throw new Error('simulated response lost AFTER modeled commit');
   }
   if(name==='multi_day_get_initial_draw_resolution_v1')return {data:{ok:true,application,cancellation:null},error:null};
   return {data:name==='multi_day_final_roster_v1'?roster:plan,error:null};
  });
  const first=render(<MultiDayInitialDrawPanel eventId={id(1)}/>);await preview();
  const confirm=screen.getByRole('button',{name:'Xác nhận xếp D2'});fireEvent.click(confirm);fireEvent.click(confirm);
  await screen.findByRole('alert');
  expect(h.rpc.mock.calls.filter(([name])=>name==='multi_day_apply_initial_draw_v1')).toHaveLength(1);
  expect(sessionStorage.length).toBe(1);first.unmount();
  render(<MultiDayInitialDrawPanel eventId={id(1)}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Kiểm tra receipt D2'}));
  await screen.findByText('Đã xếp D2 theo receipt máy chủ.');
  expect(h.rpc.mock.calls.filter(([name])=>name==='multi_day_apply_initial_draw_v1')).toHaveLength(1);
  expect(sessionStorage.length).toBe(0);
 });
 it('discards slow old-event read and never renders another event roster',async()=>{
  let resolve!:(v:unknown)=>void;const slow=new Promise(r=>{resolve=r;});
  h.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>args.p_event_id===id(1)?slow:Promise.resolve({data:{...roster,eventId:id(99),players:[{...player,name:'D2 B ONLY'}]},error:null}));
  const view=render(<MultiDayInitialDrawPanel eventId={id(1)}/>);view.rerender(<MultiDayInitialDrawPanel eventId={id(99)}/>);
  await screen.findByText(/D2 B ONLY/);resolve({data:roster,error:null});
  await waitFor(()=>expect(screen.queryByText(/D2 người TEST/)).toBeNull());
 });
 it('keeps corrupt journal alert visible even after successful roster read',async()=>{
  sessionStorage.setItem(`vinpoker:d2-initial:v1:${id(40)}:${id(1)}`,'broken-json');
  render(<MultiDayInitialDrawPanel eventId={id(1)}/>);
  await screen.findByText(/1 người qualified/);
  expect(screen.getByRole('alert').textContent).toContain('Không đọc được intent D2');
  expect(screen.getByRole('group',{name:'Chọn bàn đang mở cho D2'})).toHaveProperty('disabled',true);
 });
 it('does not discard a lost cancellation; reload resolves cancellation by read only',async()=>{
  let cancellation:unknown=null;
  h.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
   if(name==='multi_day_cancel_initial_draw_v1'){
    cancellation={ok:true,state:'CANCELLED',planId:id(12),eventId:id(1),actorId:h.actor,requestId:args.p_request_id,cancelledAt:'2026-10-17T00:00:00Z'};
    throw new Error('response lost after modeled cancellation');
   }
   if(name==='multi_day_get_initial_draw_resolution_v1')return {data:{ok:true,application:null,cancellation},error:null};
   return {data:name==='multi_day_final_roster_v1'?roster:plan,error:null};
  });
  const first=render(<MultiDayInitialDrawPanel eventId={id(1)}/>);await preview();
  fireEvent.click(screen.getByRole('button',{name:'Hủy phương án D2'}));await screen.findByRole('alert');
  expect(sessionStorage.length).toBe(1);
  expect(screen.getByRole('button',{name:'Xác nhận xếp D2'})).toHaveProperty('disabled',true);
  first.unmount();render(<MultiDayInitialDrawPanel eventId={id(1)}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Kiểm tra receipt D2'}));
  await screen.findByText(/Đã hủy phương án D2 trên server/);expect(sessionStorage.length).toBe(0);
  expect(h.rpc.mock.calls.filter(([name])=>name==='multi_day_cancel_initial_draw_v1')).toHaveLength(1);
  expect(h.rpc.mock.calls.some(([name])=>name==='multi_day_apply_initial_draw_v1')).toBe(false);
 });
});
it('releases a definitively rejected capacity preview so the operator can choose another table',async()=>{
 h.rpc.mockImplementation(async(name:string)=>name==='multi_day_plan_initial_draw_v1'
  ?{data:null,error:{code:'23514',message:'multi_day_initial_draw_insufficient_capacity'}}
  :{data:roster,error:null});
 render(<MultiDayInitialDrawPanel eventId={id(1)}/>);
 fireEvent.click(await screen.findByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Xem phương án D2'}));
 await screen.findByText(/Bàn đã chọn không đủ ghế trống/);
 expect(sessionStorage.length).toBe(0);expect(screen.getByRole('group',{name:'Chọn bàn đang mở cho D2'})).not.toBeDisabled();
 expect(h.rpc.mock.calls.some(([name])=>name==='multi_day_apply_initial_draw_v1')).toBe(false);
});
it('retains preview intent when a capacity-looking message has no authoritative SQL rejection code',async()=>{
 h.rpc.mockImplementation(async(name:string)=>name==='multi_day_plan_initial_draw_v1'
  ?{data:null,error:{message:'multi_day_initial_draw_insufficient_capacity'}}
  :{data:roster,error:null});
 render(<MultiDayInitialDrawPanel eventId={id(1)}/>);
 fireEvent.click(await screen.findByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Xem phương án D2'}));
 await screen.findByRole('alert');expect(sessionStorage.length).toBe(1);
 expect(screen.getByRole('button',{name:'Kiểm tra receipt D2'})).toBeInTheDocument();
 expect(screen.queryByRole('group',{name:'Chọn bàn đang mở cho D2'})).not.toBeInTheDocument();
});

it.each([
 ['40001','multi_day_initial_draw_source_stale','Nguồn D2 đã thay đổi'],
 ['23514','multi_day_initial_draw_table_blocked','Bàn đã chọn không còn sẵn sàng'],
])('releases a preview definitively rejected with %s/%s without inventing a cancellation',async(code,message,notice)=>{
 h.rpc.mockImplementation(async(name:string)=>name==='multi_day_plan_initial_draw_v1'
  ?{data:null,error:{code,message}}:{data:roster,error:null});
 render(<MultiDayInitialDrawPanel eventId={id(1)}/>);
 fireEvent.click(await screen.findByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Xem phương án D2'}));
 await screen.findByText(new RegExp(notice));
 expect(sessionStorage.length).toBe(0);
 expect(screen.getByRole('group',{name:'Chọn bàn đang mở cho D2'})).not.toBeDisabled();
 expect(screen.getByRole('checkbox')).not.toBeChecked();
 expect(h.rpc.mock.calls.filter(([name])=>name==='multi_day_final_roster_v1')).toHaveLength(2);
 expect(h.rpc.mock.calls.some(([name])=>['multi_day_apply_initial_draw_v1','multi_day_cancel_initial_draw_v1'].includes(name))).toBe(false);
});
it.each(['multi_day_initial_draw_source_stale','multi_day_initial_draw_table_blocked'])('keeps the original key for a %s message without an authoritative SQL code',async(message)=>{
 h.rpc.mockImplementation(async(name:string)=>name==='multi_day_plan_initial_draw_v1'?{data:null,error:{message}}:{data:roster,error:null});
 render(<MultiDayInitialDrawPanel eventId={id(1)}/>);
 fireEvent.click(await screen.findByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Xem phương án D2'}));
 await screen.findByRole('alert');expect(sessionStorage.length).toBe(1);
 expect(screen.getByRole('button',{name:'Kiểm tra receipt D2'})).toBeInTheDocument();
});
