import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({actor:'actor-a',session:{access_token:'LOCAL_TEST'},read:vi.fn(),scope:vi.fn(),export:vi.fn(),signals:[] as AbortSignal[],rejectEmbedding:false}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:h.actor},session:h.session})}));
vi.mock('@/lib/exportExcel',()=>({exportToExcel:h.export,formatExcelDate:()=>''}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{
 rpc:(name:string)=>{const promise=name==='cashier_club_ids'?h.scope():Promise.resolve({data:[{is_super_admin:false}],error:null});return Object.assign(promise,{abortSignal:(signal:AbortSignal)=>{h.signals.push(signal);return promise;}});},
 from:(table:string)=>{let embedded=false;const q={select:(fields:string)=>{embedded=fields.includes('tournament:tournament_id');return q;},in:()=>q,eq:()=>q,order:()=>q,limit:()=>q,abortSignal:(signal:AbortSignal)=>{h.signals.push(signal);return q;},then:(yes:unknown,no:unknown)=>Promise.resolve(embedded&&h.rejectEmbedding?{data:null,error:{code:'PGRST200'}}:h.read(table)).then(yes as never,no as never)};return q;},
}}));
import {HistoryTab,RefundHistoryTab} from './CashierDashboard';
const row=(club:string)=>({id:'deal-'+club,club_id:club,player_id:null,custom_event_name:'Event '+club,status:'completed',created_at:'2026-11-27',filled_percent:10,result_prize_vnd:100000,buy_in_amount_vnd:100000,refund_reason:'TEST'});
const deferred=()=>{let resolve!:(value:unknown)=>void;const promise=new Promise(resolvePromise=>{resolve=resolvePromise;});return {promise,resolve};};
beforeEach(()=>{h.actor='actor-a';h.session={access_token:'LOCAL_TEST'};h.read.mockReset().mockResolvedValue({data:[row('club-a'),row('club-b')],error:null});h.scope.mockReset().mockResolvedValue({data:['club-a','club-b'],error:null});h.export.mockReset();h.signals=[];h.rejectEmbedding=false;});
afterEach(()=>{cleanup();vi.useRealTimers();});
describe.each([['history',HistoryTab],['refund history',RefundHistoryTab]] as const)('%s current export authority',(_name,Tab)=>{
 it('exports only B after A is revoked, even when cached rows include both',async()=>{
  render(<Tab clubIds={['club-a','club-b']}/>);await screen.findByText('Event club-a');h.scope.mockResolvedValue({data:['club-b'],error:null});
  await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Excel'})));
  expect(h.export).toHaveBeenCalledOnce();expect(h.export.mock.calls[0][0].map((r:{club_id:string})=>r.club_id)).toEqual(['club-b']);
 });
 it('does not deliver a file when current authority cannot be verified',async()=>{
  render(<Tab clubIds={['club-a','club-b']}/>);await screen.findByText('Event club-a');h.scope.mockResolvedValue({data:null,error:{message:'offline'}});
  await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Excel'})));
  expect(h.export).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toHaveTextContent('Chưa xác minh được quyền xuất');
 });
 it('cancels an old actor export while its authority response is pending',async()=>{
  const old=deferred();const view=render(<Tab clubIds={['club-a','club-b']}/>);await screen.findByText('Event club-a');h.scope.mockReturnValue(old.promise);
  fireEvent.click(screen.getByRole('button',{name:'Excel'}));h.actor='actor-b';h.read.mockResolvedValue({data:[row('club-b')],error:null});
  await act(async()=>view.rerender(<Tab clubIds={['club-b']}/>));
  await act(async()=>old.resolve({data:['club-a','club-b'],error:null}));
  expect(h.export).not.toHaveBeenCalled();expect(screen.queryByText('Event club-a')).not.toBeInTheDocument();
 });
 it('single-flights double export clicks',async()=>{
  const pending=deferred();render(<Tab clubIds={['club-a','club-b']}/>);await screen.findByText('Event club-a');h.scope.mockReturnValue(pending.promise);
  act(()=>{fireEvent.click(screen.getByRole('button',{name:'Excel'}));fireEvent.click(screen.getByRole('button',{name:'Excel'}));});
  expect(h.scope).toHaveBeenCalledOnce();await act(async()=>pending.resolve({data:['club-b'],error:null}));
  expect(h.export).toHaveBeenCalledOnce();
 });
 it('rejects a foreign-club response rather than exposing a stale export button',async()=>{
  render(<Tab clubIds={['club-b']}/>);expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được lịch sử');
  expect(screen.queryByText('Event club-a')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Excel'})).toBeDisabled();
 });
 it('does not interpret empty club IDs as global data access',async()=>{
  await act(async()=>{render(<Tab clubIds={[]}/>);});
  expect(h.read).not.toHaveBeenCalled();expect(h.export).not.toHaveBeenCalled();
  expect(screen.getByRole('button',{name:'Excel'})).toBeDisabled();
 });
 it('ignores late A data after switching to B',async()=>{
  const old=deferred();h.read.mockReturnValueOnce(old.promise);const view=render(<Tab clubIds={['club-a']}/>);
  await act(async()=>{});h.read.mockResolvedValue({data:[row('club-b')],error:null});await act(async()=>view.rerender(<Tab clubIds={['club-b']}/>));
  await screen.findByText('Event club-b');await act(async()=>old.resolve({data:[row('club-a')],error:null}));
  expect(screen.queryByText('Event club-a')).not.toBeInTheDocument();expect(screen.getByText('Event club-b')).toBeInTheDocument();
 });
 it('bounds a stalled export lookup and aborts without downloading',async()=>{
  render(<Tab clubIds={['club-a','club-b']}/>);await screen.findByText('Event club-a');const pending=deferred();h.scope.mockReturnValue(pending.promise);
  vi.useFakeTimers();fireEvent.click(screen.getByRole('button',{name:'Excel'}));await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});
  expect(h.export).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toHaveTextContent('Chưa xác minh được quyền xuất');
  expect(h.signals.some(signal=>signal.aborted)).toBe(true);
  await act(async()=>pending.resolve({data:['club-a'],error:null}));expect(h.export).not.toHaveBeenCalled();
 });
});

describe('refund history without a tournament FK',()=>{
 it('reads custom-event refunds without an embedded relationship',async()=>{
  h.rejectEmbedding=true;h.read.mockResolvedValue({data:[row('club-b')],error:null});render(<RefundHistoryTab clubIds={['club-b']}/>);
  expect(await screen.findByText('Event club-b')).toBeInTheDocument();expect(screen.queryByRole('alert')).not.toBeInTheDocument();
 });
 it('resolves a native tournament name through a scoped lookup',async()=>{
  h.read.mockImplementation(table=>Promise.resolve({data:table==='tournaments'?[{id:'tour-b',club_id:'club-b',name:'Native Tour B'}]:[{...row('club-b'),custom_event_name:null,tournament_id:'tour-b'}],error:null}));
  render(<RefundHistoryTab clubIds={['club-b']}/>);expect(await screen.findByText('Native Tour B')).toBeInTheDocument();
 });
 it('marks a mismatched tournament name unverified rather than assigning A to a B deal',async()=>{
  h.read.mockImplementation(table=>Promise.resolve({data:table==='tournaments'?[{id:'tour-a',club_id:'club-a',name:'Foreign Tour A'}]:[{...row('club-b'),custom_event_name:null,tournament_id:'tour-a'}],error:null}));
  render(<RefundHistoryTab clubIds={['club-a','club-b']}/>);expect(await screen.findByText('Chưa xác minh tên giải')).toBeInTheDocument();
  expect(screen.queryByText('Foreign Tour A')).not.toBeInTheDocument();
 });
 it('does not describe a failed history read as a confirmed empty dataset',async()=>{
  h.read.mockResolvedValue({data:null,error:{code:'503'}});render(<RefundHistoryTab clubIds={['club-b']}/>);await screen.findByRole('alert');
  expect(screen.queryByText('0 dòng')).not.toBeInTheDocument();expect(screen.queryByText('Không có dữ liệu')).not.toBeInTheDocument();
 });
});
