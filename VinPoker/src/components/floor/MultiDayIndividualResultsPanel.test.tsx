import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/integrations/supabase/SupabaseClientContext',()=>({useSupabaseClient:()=>({rpc:h.rpc})}));
import {MultiDayIndividualResultsPanel} from './MultiDayIndividualResultsPanel';
import {individualResultsJournalKey} from '@/ops/floor/multiDayIndividualResults';
const id=(n:number)=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
const props={actorId:id(1),eventId:id(2),backendScope:'http://127.0.0.1:54329',active:true,held:false,onHeld:vi.fn()};
const f={event_id:id(2),tournament_id:id(3),entry_id:id(6),participation_id:id(8),player_id:id(4),entry_no:1,finished_place:2,
 source_hash:'a'.repeat(32),actor_id:id(1),request_id:id(10)};
const view=(frozen=false)=>({eventId:id(2),tournamentId:id(3),field:2,sourceHash:'a'.repeat(32),
 participants:[{entryId:id(6),participationId:id(8),playerId:id(4),entryNo:1},{entryId:id(7),participationId:id(9),playerId:id(5),entryNo:1}],
 ranking:{tournamentId:id(3),field:2,survivors:1,sourceHash:'b'.repeat(32),missingOrders:1,requiresReview:false,
 activeHand:false,evidencePending:false,hasOfficial:false,simultaneousHands:[],simultaneousGroups:[],entries:[
  {entryId:id(6),playerId:id(4),entryNo:1,name:'Người A TEST',status:'busted',bustOrder:null,finishedPlace:null},
  {entryId:id(7),playerId:id(5),entryNo:1,name:'Người B TEST',status:'registered',bustOrder:null,finishedPlace:null}]},
 individualResults:frozen?[f]:[],individualObligations:[]});
const preview={ok:true,state:'READY_TO_CONFIRM',paymentExecution:'NOT_PERFORMED',
 quote:{eventId:id(2),participationId:id(8),entryId:id(6),playerId:id(4),rank:2,totalVnd:100000,quoteHash:'c'.repeat(32)},
 funding:{eventId:id(2),finalTournamentId:id(3),state:'INCOMING_SOURCE_VERIFIED',sourceInputHash:'d'.repeat(32)},
 budget:{eventId:id(2),requiredTotalVnd:200000,fundedVnd:400000,requiredShortfallVnd:0,budgetHash:'e'.repeat(32)}};
const rankReceipt=(request:string)=>({ok:true,outcome:'recorded',eventId:id(2),requestId:request,sourceHash:'a'.repeat(32),
 individualResults:[{...f,request_id:request}],paymentExecution:'NOT_PERFORMED'});
const obligationReceipt=(request:string)=>({ok:true,outcome:'recorded',eventId:id(2),requestId:request,paymentExecution:'NOT_PERFORMED',
 obligation:{...f,amount_vnd:100000,request_id:request,quote_hash:'c'.repeat(32),source_input_hash:'d'.repeat(32),budget_hash:'e'.repeat(32)}});
const key=individualResultsJournalKey(id(1),id(2));
function triple(frozen=false){
 const p=view();p.field=3;p.ranking.field=3;p.ranking.entries[1].status='busted';
 p.ranking.entries.push({entryId:id(30),playerId:id(31),entryNo:1,name:'Người C TEST',status:'registered',bustOrder:null,finishedPlace:null});
 p.participants.push({entryId:id(30),participationId:id(32),playerId:id(31),entryNo:1});
 if(frozen)p.individualResults=[{...f,finished_place:3}];return p;
}
beforeEach(()=>{sessionStorage.clear();h.rpc.mockReset();props.onHeld.mockReset();
 h.rpc.mockResolvedValue({data:view(),error:null});});
afterEach(cleanup);
const load=async()=>{fireEvent.click(screen.getByRole('button',{name:'Đọc lại hạng cá nhân'}));await screen.findByText(/Hạng 2 · Người A TEST/);};
const confirmRank=()=>{fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Chốt hạng cá nhân'}));};
describe('individual Floor rank and obligation controls',()=>{
 it('shows official DB places in rank order without draft reorder controls after close',async()=>{
  const original=view();
  const closed={...original,ranking:{...original.ranking,hasOfficial:true,
   entries:original.ranking.entries.map((entry,index)=>({...entry,finishedPlace:index===0?2:1}))}};
  h.rpc.mockResolvedValue({data:closed,error:null});
  render(<MultiDayIndividualResultsPanel {...props}/>);
  fireEvent.click(screen.getByRole('button',{name:'Đọc lại hạng cá nhân'}));
  await screen.findByText('Giải đã chốt. Hạng chính thức từ DB:');
  const rows=screen.getAllByRole('listitem').map(row=>row.textContent);
  expect(rows).toEqual(['Hạng 1 · Người B TEST · entry #1','Hạng 2 · Người A TEST · entry #1']);
  expect(screen.queryByRole('button',{name:/Nâng hạng entry|Hạ hạng entry/})).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Chốt hạng cá nhân'})).not.toBeInTheDocument();
  expect(h.rpc.mock.calls.map(call=>call[0])).toEqual(['get_multi_day_individual_rank_review_v1']);
 });
 it('reads a previously finalized obligation after a fresh mount without requiring its old journal',async()=>{
  const persisted={eventId:id(2),tournamentId:id(3),participationId:id(8),entryId:id(6),playerId:id(4),rank:2,totalVnd:100000,requestId:id(10),confirmedAt:'2026-10-28T00:00:00+07:00'};
  h.rpc.mockImplementation(async(name:string)=>({data:name==='get_multi_day_individual_obligation_preview_v1'?preview:{...view(true),individualObligations:[persisted]},error:null}));
  render(<MultiDayIndividualResultsPanel {...props}/>);await load();
  expect(screen.getByText('Đã chốt nghĩa vụ 100.000 ₫ · chưa phải trạng thái đã trả.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Xem nghĩa vụ hạng 2'}));await screen.findByText(/nghĩa vụ cá nhân 100.000/);
  expect(screen.queryByRole('button',{name:'Chốt nghĩa vụ cá nhân'})).not.toBeInTheDocument();
  expect(sessionStorage.getItem(key)).toBeNull();expect(h.rpc.mock.calls.some(([name])=>name==='confirm_multi_day_individual_obligation_v1')).toBe(false);
 });
 it('does not infer no existing obligation when the deployed read contract omits its state',async()=>{
  const legacy=Object.fromEntries(Object.entries(view(true)).filter(([key])=>key!=='individualObligations'));
  h.rpc.mockImplementation(async(name:string)=>({data:name==='get_multi_day_individual_obligation_preview_v1'?preview:legacy,error:null}));
  render(<MultiDayIndividualResultsPanel {...props}/>);await load();
  expect(screen.getByText('Chưa xác minh được nghĩa vụ đã chốt từ DB. Chưa thể chốt nghĩa vụ mới.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Xem nghĩa vụ hạng 2'}));await screen.findByText(/nghĩa vụ cá nhân 100.000/);
  expect(screen.getByRole('button',{name:'Chốt nghĩa vụ cá nhân'})).toBeDisabled();
 });
 it('requires Floor to confirm again after swapping two unconfirmed manual busts',async()=>{
  h.rpc.mockImplementation(async(name:string)=>{if(name==='confirm_multi_day_individual_ranks_v1')throw Error('lost');return {data:triple(),error:null};});
  render(<MultiDayIndividualResultsPanel {...props}/>);await load();fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button',{name:`Hạ hạng entry ${id(6)}`}));
  expect(screen.getByRole('checkbox')).not.toBeChecked();expect(screen.getByRole('button',{name:'Chốt hạng cá nhân'})).toBeDisabled();
  confirmRank();await screen.findByText(/Chưa xác minh được kết quả/);
  expect(h.rpc.mock.calls.find(([n])=>n==='confirm_multi_day_individual_ranks_v1')?.[1].p_ordered_busted_entry_ids).toEqual([id(7),id(6)]);
 });
 it('cannot move an already frozen rank when later busts are added',async()=>{
  h.rpc.mockResolvedValue({data:triple(true),error:null});render(<MultiDayIndividualResultsPanel {...props}/>);
  fireEvent.click(screen.getByRole('button',{name:'Đọc lại hạng cá nhân'}));await screen.findByText(/Hạng 3 · Người A TEST/);
  expect(screen.getByRole('button',{name:`Nâng hạng entry ${id(6)}`})).toBeDisabled();
  expect(screen.getByRole('button',{name:`Hạ hạng entry ${id(7)}`})).toBeDisabled();
  expect(screen.getByRole('button',{name:'Chốt hạng cá nhân'})).toBeDisabled();
 });
 it('requires explicit Floor confirmation and submits a full order without any amount',async()=>{
  h.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>({data:name==='confirm_multi_day_individual_ranks_v1'?rankReceipt(String(args.p_request_id)):view(name==='get_multi_day_individual_rank_review_v1'&&h.rpc.mock.calls.some(([n])=>n==='confirm_multi_day_individual_ranks_v1')),error:null}));
  render(<MultiDayIndividualResultsPanel {...props}/>);await load();
  expect(screen.getByRole('button',{name:'Chốt hạng cá nhân'})).toBeDisabled();confirmRank();
  await screen.findByText('Đã xác minh hạng cá nhân. Thao tác này không chốt nghĩa vụ hoặc ghi trả thưởng.');
  const writes=h.rpc.mock.calls.filter(([name])=>name==='confirm_multi_day_individual_ranks_v1');expect(writes).toHaveLength(1);
  expect(writes[0][1]).toEqual({p_event_id:id(2),p_expected_source_hash:'a'.repeat(32),p_ordered_busted_entry_ids:[id(6)],p_request_id:expect.any(String)});
  expect(sessionStorage.getItem(key)).toBeNull();expect(h.rpc.mock.calls.some(([name])=>/payment/.test(name))).toBe(false);
 });
 it('keeps an unknown rank request across remount and resolves by receipt read only',async()=>{
  let request='';h.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
   if(name==='confirm_multi_day_individual_ranks_v1'){request=String(args.p_request_id);throw Error('503 after commit');}
   return {data:name==='get_multi_day_individual_rank_receipt_v1'?{ok:true,outcome:'recorded',receipt:rankReceipt(request)}:view(!!request),error:null};
  });
  const first=render(<MultiDayIndividualResultsPanel {...props}/>);await load();confirmRank();
  await screen.findByText('Chưa xác minh được kết quả. Giữ nguyên yêu cầu, không tạo yêu cầu thay thế.');
  const retained=sessionStorage.getItem(key);expect(retained).toContain(request);first.unmount();
  render(<MultiDayIndividualResultsPanel {...props}/>);
  expect(screen.getByRole('button',{name:'Đọc lại hạng cá nhân'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'Kiểm tra receipt cá nhân'}));
  await screen.findByText('Đã xác minh hạng cá nhân. Thao tác này không chốt nghĩa vụ hoặc ghi trả thưởng.');
  expect(sessionStorage.getItem(key)).toBeNull();expect(h.rpc.mock.calls.filter(([n])=>n==='confirm_multi_day_individual_ranks_v1')).toHaveLength(1);
  expect(h.rpc).toHaveBeenCalledWith('get_multi_day_individual_rank_receipt_v1',{p_event_id:id(2),p_request_id:request});
 });
 it('does not treat NOT_FOUND as success or permission to discard an unknown request',async()=>{
  h.rpc.mockImplementation(async(name:string)=>{if(name==='confirm_multi_day_individual_ranks_v1')throw Error('lost');return {data:name==='get_multi_day_individual_rank_receipt_v1'?{ok:true,outcome:'not_found',receipt:null}:view(),error:null};});
  render(<MultiDayIndividualResultsPanel {...props}/>);await load();confirmRank();
  await screen.findByText(/Chưa xác minh được kết quả/);const retained=sessionStorage.getItem(key);
  fireEvent.click(screen.getByRole('button',{name:'Kiểm tra receipt cá nhân'}));await screen.findByText(/Chưa tìm thấy receipt/);
  expect(sessionStorage.getItem(key)).toBe(retained);expect(screen.getByRole('button',{name:'Đọc lại hạng cá nhân'})).toBeDisabled();
 });
 it('shows server full-field budget and confirms exactly its three hashes without a payment RPC',async()=>{
  h.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>({data:name==='get_multi_day_individual_obligation_preview_v1'?preview:name==='confirm_multi_day_individual_obligation_v1'?obligationReceipt(String(args.p_request_id)):view(true),error:null}));
  render(<MultiDayIndividualResultsPanel {...props}/>);await load();
  fireEvent.click(screen.getByRole('button',{name:'Xem nghĩa vụ hạng 2'}));await screen.findByText(/nghĩa vụ cá nhân 100.000/);
  expect(screen.getByText(/Ngân sách toàn Main Event/)).toHaveTextContent('200.000');
  fireEvent.click(screen.getByRole('button',{name:'Chốt nghĩa vụ cá nhân'}));
  await screen.findByText('Đã xác minh nghĩa vụ cá nhân. Thao tác này không ghi nhận trả thưởng.');
  expect(h.rpc).toHaveBeenCalledWith('confirm_multi_day_individual_obligation_v1',{
   p_event_id:id(2),p_participation_id:id(8),p_expected_quote_hash:'c'.repeat(32),p_expected_source_hash:'d'.repeat(32),p_expected_budget_hash:'e'.repeat(32),p_request_id:expect.any(String)});
  expect(sessionStorage.getItem(key)).toBeNull();expect(h.rpc.mock.calls.some(([name])=>/payment/.test(name))).toBe(false);
 });
 it('holds an obligation receipt whose amount does not match the reviewed amount',async()=>{
  h.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
   const receipt=obligationReceipt(String(args.p_request_id));return {data:name==='get_multi_day_individual_obligation_preview_v1'?preview:name==='confirm_multi_day_individual_obligation_v1'?{...receipt,obligation:{...receipt.obligation,amount_vnd:100001}}:view(true),error:null};});
  render(<MultiDayIndividualResultsPanel {...props}/>);await load();fireEvent.click(screen.getByRole('button',{name:'Xem nghĩa vụ hạng 2'}));
  await screen.findByText(/nghĩa vụ cá nhân 100.000/);fireEvent.click(screen.getByRole('button',{name:'Chốt nghĩa vụ cá nhân'}));
  await screen.findByText(/Chưa xác minh được kết quả/);expect(sessionStorage.getItem(key)).not.toBeNull();expect(screen.getByRole('button',{name:'Đọc lại hạng cá nhân'})).toBeDisabled();
 });
 it('blocks an underfunded full budget even when the individual amount fits',async()=>{
  h.rpc.mockImplementation(async(name:string)=>({data:name==='get_multi_day_individual_obligation_preview_v1'?{...preview,state:'REQUIRED_SHORTFALL',budget:{...preview.budget,requiredTotalVnd:500000,requiredShortfallVnd:100000}}:view(true),error:null}));
  render(<MultiDayIndividualResultsPanel {...props}/>);await load();fireEvent.click(screen.getByRole('button',{name:'Xem nghĩa vụ hạng 2'}));await screen.findByText(/nghĩa vụ cá nhân 100.000/);
  expect(screen.getByRole('button',{name:'Chốt nghĩa vụ cá nhân'})).toBeDisabled();expect(sessionStorage.getItem(key)).toBeNull();
 });
 it('never writes when journal persistence fails',async()=>{
  render(<MultiDayIndividualResultsPanel {...props}/>);await load();const spy=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('quota');});
  try{confirmRank();await screen.findByText('Không lưu được yêu cầu. Chưa gửi thao tác.');expect(h.rpc.mock.calls.some(([n])=>n==='confirm_multi_day_individual_ranks_v1')).toBe(false);}finally{spy.mockRestore();}
 });
 it('keeps a retained request blocked when actor/event backend identity changes',async()=>{
  h.rpc.mockImplementation(async(name:string)=>{if(name==='confirm_multi_day_individual_ranks_v1')throw Error('lost');return {data:view(),error:null};});
  const first=render(<MultiDayIndividualResultsPanel {...props}/>);await load();confirmRank();await screen.findByText(/Chưa xác minh được kết quả/);const retained=sessionStorage.getItem(key);first.unmount();
  render(<MultiDayIndividualResultsPanel {...props} backendScope="http://127.0.0.1:54330"/>);
  expect(screen.getByText('Không xác minh được yêu cầu đã lưu. Tạm khóa thao tác mới.')).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Đọc lại hạng cá nhân'})).toBeDisabled();expect(sessionStorage.getItem(key)).toBe(retained);
 });
 it('rejects a cross-event read instead of displaying its people',async()=>{
  h.rpc.mockResolvedValue({data:{...view(),eventId:id(22)},error:null});render(<MultiDayIndividualResultsPanel {...props}/>);
  fireEvent.click(screen.getByRole('button',{name:'Đọc lại hạng cá nhân'}));await screen.findByRole('alert');expect(screen.queryByText(/Hạng 2 · Người A/)).not.toBeInTheDocument();
 });
 it('ignores a late old-event read after changing scope',async()=>{
  let resolve!:(r:unknown)=>void;h.rpc.mockReturnValue(new Promise(r=>{resolve=r;}));
  const ui=render(<MultiDayIndividualResultsPanel {...props}/>);fireEvent.click(screen.getByRole('button',{name:'Đọc lại hạng cá nhân'}));
  ui.rerender(<MultiDayIndividualResultsPanel {...props} eventId={id(22)}/>);
  await act(async()=>resolve({data:view(),error:null}));expect(screen.queryByText(/Hạng 2 · Người A/)).not.toBeInTheDocument();
 });
 it('clears a definitive stale-source rejection and requires a fresh explicit review',async()=>{
  h.rpc.mockImplementation(async(name:string)=>name==='confirm_multi_day_individual_ranks_v1'?{data:null,error:{code:'P0001',message:'individual_rank_source_changed'}}:{data:view(),error:null});
  render(<MultiDayIndividualResultsPanel {...props}/>);await load();confirmRank();await screen.findByText(/Nguồn hoặc thứ tự không còn hợp lệ/);
  await waitFor(()=>expect(sessionStorage.getItem(key)).toBeNull());expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Đọc lại hạng cá nhân'})).toBeEnabled();
 });
});
