import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,describe,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({invoke:vi.fn(),preview:vi.fn(),read:vi.fn(),success:vi.fn(),error:vi.fn(),warning:vi.fn(),userId:'e5310000-0000-4000-8000-000000000001',session:{access_token:'LOCAL_A'},signals:[] as AbortSignal[]}));
const purchase='e4860000-0000-4000-8000-000000000001';
const deal='e4860000-0000-4000-8000-000000000002';
const delivered=(request_id:string)=>({request_id,deal_id:deal,expected:2,total:2,delivered:2,pending:0,processing:0,needs_attention:0,evidence_missing:false,state:'all_delivered'});
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:f.userId},session:f.session})}));
vi.mock('sonner',()=>({toast:{success:f.success,error:f.error,warning:f.warning}}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:()=>({abortSignal:()=>f.preview()}),functions:{invoke:f.invoke},from:(table:string)=>{
 const rows=table==='staking_purchases'?[{id:purchase,deal_id:deal,backer_id:'e5590000-0000-4000-8000-000000000001',percent:10,amount_vnd:100000,reference_code:'TEST486',
  deal:{id:deal,club_id:'club',player_id:'e5590000-0000-4000-8000-000000000002',custom_event_name:'Staking486 TEST'}}]
  :table==='staking_deals'?[{id:deal,club_id:'club',status:'funded',custom_event_name:'Staking486 TEST',buy_in_amount_vnd:1000000,filled_percent:10}]:[];
 const q={select:()=>q,in:()=>q,eq:()=>q,order:()=>q,abortSignal:(signal:AbortSignal)=>{f.signals.push(signal);return q;},
  then:(resolve:(value:unknown)=>unknown,reject:(reason:unknown)=>unknown)=>Promise.resolve(f.read(table,rows)).then(resolve,reject)};
 return q;
}}}));
import {PendingConfirmTab,RefundTab} from './CashierDashboard';
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();f.signals=[];f.userId='e5310000-0000-4000-8000-000000000001';f.session={access_token:'LOCAL_A'};f.read.mockImplementation((_table,rows)=>({data:rows,error:null}));
 f.preview.mockResolvedValue({data:{deal_id:deal,club_id:'club',label:'Staking486 TEST',state:'eligible',amount_vnd:110000,purchase_count:2},error:null});
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_name:string,_options:unknown,callback:(lock:unknown)=>unknown)=>callback({name:'LOCAL_LOCK'})}});
});
async function confirmRefund(){const button=screen.getByRole('button',{name:'Xác nhận hoàn tiền'});await waitFor(()=>expect(button).toBeEnabled());await act(async()=>{fireEvent.click(button);});}
describe('Cashier staking explicit outcomes',()=>{
 it.each([{clubs:['club']},{clubs:[]}])('does not display a global null-club Admin intent in Cashier scope %j',async({clubs})=>{
  localStorage.setItem(`vinpoker:staking-funding:v1:${f.userId}:${purchase}`,JSON.stringify({actor_id:f.userId,purchase_id:purchase,club_id:null,reference:'GLOBAL_ADMIN_ONLY'}));
  render(<PendingConfirmTab clubIds={clubs}/>);await screen.findByRole('button',{name:'Xác nhận FUNDED'});
  expect(screen.queryByRole('button',{name:'Tra kết quả FUNDED GLOBAL_ADMIN_ONLY'})).not.toBeInTheDocument();expect(f.invoke).not.toHaveBeenCalled();
 });
 it('keeps a persistent unknown-outcome explanation after a funding HTTP error',async()=>{
  f.invoke.mockResolvedValue({data:null,error:{message:'Edge Function returned a non-2xx status code'}});
  render(<PendingConfirmTab clubIds={['club']}/>);fireEvent.click(await screen.findByRole('button',{name:'Xác nhận FUNDED'}));
  expect(await screen.findByRole('status')).toHaveTextContent('Chưa xác minh được kết quả FUNDED (TEST486)');
  expect(screen.getByRole('status')).toHaveTextContent('dùng Tra kết quả');expect(f.success).not.toHaveBeenCalled();
  expect(screen.getByRole('button',{name:'Xác nhận FUNDED'})).toBeDisabled();expect(localStorage.length).toBe(1);
 });
 it('bounds a hung funding receipt read without retrying or clearing its intent',async()=>{
  localStorage.setItem(`vinpoker:staking-funding:v1:${f.userId}:${purchase}`,JSON.stringify({actor_id:f.userId,purchase_id:purchase,club_id:'club',reference:'TEST486'}));
  f.invoke.mockImplementation(()=>new Promise(()=>{}));render(<PendingConfirmTab clubIds={['club']}/>);
  const recovery=await screen.findByRole('button',{name:'Tra kết quả FUNDED TEST486'});
  vi.useFakeTimers();try{fireEvent.click(recovery);await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});
   expect(screen.getByRole('status')).toHaveTextContent('Không tra được');expect(recovery).toBeEnabled();expect(f.invoke).toHaveBeenCalledOnce();
   expect(f.invoke.mock.calls[0][1].signal.aborted).toBe(true);expect(localStorage.length).toBe(1);
  }finally{vi.useRealTimers();}
 });
 it('blocks monetary confirmation when saved recovery evidence is corrupt',async()=>{
  localStorage.setItem(`vinpoker:staking-funding:v1:${f.userId}:${purchase}`,'LOCAL_CORRUPT');render(<PendingConfirmTab clubIds={['club']}/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Giữ nguyên dữ liệu');
  expect(await screen.findByRole('button',{name:'Xác nhận FUNDED'})).toBeDisabled();expect(f.invoke).not.toHaveBeenCalled();expect(localStorage.length).toBe(1);
 });
 it.each(['not_recorded','needs_attention'])('never auto-retries a recovered %s observation',async state=>{
  localStorage.setItem(`vinpoker:staking-funding:v1:${f.userId}:${purchase}`,JSON.stringify({actor_id:f.userId,purchase_id:purchase,club_id:'club',reference:'TEST486'}));
  f.invoke.mockResolvedValue({data:{success:false,purchase_id:purchase,state},error:null});render(<PendingConfirmTab clubIds={['club']}/>);
  expect(await screen.findByRole('button',{name:'Xác nhận FUNDED'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'Tra kết quả FUNDED TEST486'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Tra kết quả FUNDED TEST486'})).toBeEnabled());
  expect(f.invoke).toHaveBeenCalledTimes(1);expect(f.success).not.toHaveBeenCalled();expect(localStorage.length).toBe(1);
  if(state==='needs_attention')expect(screen.getByRole('button',{name:'Xác nhận FUNDED'})).toBeDisabled();
  else{expect(screen.getByRole('button',{name:'Xác nhận FUNDED'})).toBeEnabled();f.invoke.mockRejectedValueOnce(new Error('LOCAL explicit retry lost'));
   fireEvent.click(screen.getByRole('button',{name:'Xác nhận FUNDED'}));await waitFor(()=>expect(f.invoke).toHaveBeenCalledTimes(2));
   expect(f.invoke.mock.calls[1]).toEqual(['admin-confirm-funded',{body:{purchase_id:purchase}}]);expect(localStorage.length).toBe(1);}
 });
 it('clears only the exact intent after funded receipt and both email acknowledgements',async()=>{
  localStorage.setItem(`vinpoker:staking-funding:v1:${f.userId}:${purchase}`,JSON.stringify({actor_id:f.userId,purchase_id:purchase,club_id:'club',reference:'TEST486'}));
  f.invoke.mockResolvedValue({data:{success:true,purchase_id:purchase,purchase_status:'funded',deal_status:'funded',total_funded_percent:10,total_committed_percent:0,
   delivery:{purchase_id:purchase,expected:2,total:2,delivered:2,pending:0,processing:0,needs_attention:0,evidence_missing:false,state:'all_delivered'}},error:null});
  render(<PendingConfirmTab clubIds={['club']}/>);fireEvent.click(await screen.findByRole('button',{name:'Tra kết quả FUNDED TEST486'}));
  await waitFor(()=>expect(localStorage.length).toBe(0));expect(screen.queryByRole('button',{name:'Tra kết quả FUNDED TEST486'})).not.toBeInTheDocument();
 });
 it('does not display old-session recovery receipt or clear its journal',async()=>{
  localStorage.setItem(`vinpoker:staking-funding:v1:${f.userId}:${purchase}`,JSON.stringify({actor_id:f.userId,purchase_id:purchase,club_id:'club',reference:'TEST486'}));
  let resolve!:(v:unknown)=>void;f.invoke.mockImplementation(()=>new Promise(r=>{resolve=r;}));const view=render(<PendingConfirmTab clubIds={['club']}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Tra kết quả FUNDED TEST486'}));f.session={access_token:'LOCAL_B'};view.rerender(<PendingConfirmTab clubIds={['club']}/>);
  await act(async()=>resolve({data:{success:true,purchase_id:purchase,purchase_status:'funded',deal_status:'funded',total_funded_percent:10,total_committed_percent:0},error:null}));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();expect(localStorage.length).toBe(1);expect(f.success).not.toHaveBeenCalled();
 });
 it('keeps malformed status evidence and does not enable another money confirmation',async()=>{
  localStorage.setItem(`vinpoker:staking-funding:v1:${f.userId}:${purchase}`,JSON.stringify({actor_id:f.userId,purchase_id:purchase,club_id:'club',reference:'TEST486'}));
  f.invoke.mockResolvedValue({data:{success:false,purchase_id:purchase,state:'not_recorded',retry_safe:true},error:null});render(<PendingConfirmTab clubIds={['club']}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Tra kết quả FUNDED TEST486'}));expect(await screen.findByRole('status')).toHaveTextContent('Không tra được');
  expect(screen.getByRole('button',{name:'Xác nhận FUNDED'})).toBeDisabled();expect(localStorage.length).toBe(1);
 });
 it('keeps funding recovery available after reload with an empty pending list without auto-submitting',async()=>{
  localStorage.setItem(`vinpoker:staking-funding:v1:${f.userId}:${purchase}`,JSON.stringify({actor_id:f.userId,purchase_id:purchase,club_id:'club',reference:'TEST486'}));
  f.read.mockResolvedValue({data:[],error:null});render(<PendingConfirmTab clubIds={['club']}/>);
  expect(await screen.findByRole('button',{name:'Tra kết quả FUNDED TEST486'})).toBeEnabled();expect(f.invoke).not.toHaveBeenCalled();
 });
 it('persists exact intent before dispatching funding and keeps it after response loss',async()=>{
  f.invoke.mockImplementation(()=>{expect(localStorage.getItem(`vinpoker:staking-funding:v1:${f.userId}:${purchase}`)).toContain(purchase);throw new Error('LOCAL lost response');});
  render(<PendingConfirmTab clubIds={['club']}/>);fireEvent.click(await screen.findByRole('button',{name:'Xác nhận FUNDED'}));
  await waitFor(()=>expect(f.invoke).toHaveBeenCalledOnce());expect(await screen.findByRole('button',{name:'Tra kết quả FUNDED TEST486'})).toBeEnabled();
  expect(f.success).not.toHaveBeenCalled();
 });
 it('recovers funded/held-email status using only the read endpoint',async()=>{
  localStorage.setItem(`vinpoker:staking-funding:v1:${f.userId}:${purchase}`,JSON.stringify({actor_id:f.userId,purchase_id:purchase,club_id:'club',reference:'TEST486'}));
  f.read.mockResolvedValue({data:[],error:null});f.invoke.mockResolvedValue({data:{success:true,purchase_id:purchase,purchase_status:'funded',deal_status:'funded',total_funded_percent:10,total_committed_percent:0,
   delivery:{purchase_id:purchase,expected:2,total:2,delivered:1,pending:0,processing:0,needs_attention:1,evidence_missing:false,state:'needs_attention'}},error:null});
  render(<PendingConfirmTab clubIds={['club']}/>);fireEvent.click(await screen.findByRole('button',{name:'Tra kết quả FUNDED TEST486'}));
  expect(await screen.findByRole('status')).toHaveTextContent('email cần đối chiếu');
  expect(f.invoke).toHaveBeenCalledExactlyOnceWith('admin-staking-funding-status',expect.objectContaining({body:{purchase_id:purchase}}));
  expect(localStorage.length).toBe(1);
 });
 it('does not dispatch funding when durable storage rejects the write',async()=>{
  const spy=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('LOCAL quota');});
  try{render(<PendingConfirmTab clubIds={['club']}/>);fireEvent.click(await screen.findByRole('button',{name:'Xác nhận FUNDED'}));await waitFor(()=>expect(f.error).toHaveBeenCalled());expect(f.invoke).not.toHaveBeenCalled();}finally{spy.mockRestore();}
 });
 it.each(['purchase','profile','malformed'])('shows a funding-list error rather than empty data for %s failure',async fault=>{
  f.read.mockImplementation((table,rows)=>fault==='purchase'&&table==='staking_purchases'||fault==='profile'&&table==='profiles'
   ?{data:null,error:{message:'LOCAL503'}}:fault==='malformed'&&table==='staking_purchases'?{data:{unexpected:true},error:null}:{data:rows,error:null});
  render(<PendingConfirmTab clubIds={['club']}/>);expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được');
  expect(screen.queryByText('Không có yêu cầu chờ xác nhận')).not.toBeInTheDocument();expect(f.invoke).not.toHaveBeenCalled();
 });
 it('bounds a hung funding-list read and aborts it',async()=>{
  vi.useFakeTimers();try{f.read.mockImplementation(()=>new Promise(()=>{}));render(<PendingConfirmTab clubIds={['club']}/>);
   await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});expect(screen.getByRole('alert')).toHaveTextContent('Không tải được');expect(f.signals[0].aborted).toBe(true);
  }finally{vi.useRealTimers();}
 });
 it('ignores an older empty funding response after a newer successful load',async()=>{
  let resolve!:(v:unknown)=>void;let calls=0;
  f.read.mockImplementation((table,rows)=>table==='staking_purchases'&&++calls===1?new Promise(r=>{resolve=r;}):{data:rows,error:null});
  const view=render(<PendingConfirmTab clubIds={['club']}/>);await waitFor(()=>expect(f.read).toHaveBeenCalled());const first=f.signals[0];
  view.rerender(<PendingConfirmTab clubIds={['club']}/>);
  expect(await screen.findByRole('button',{name:'Xác nhận FUNDED'})).toBeEnabled();expect(first.aborted).toBe(true);
  await act(async()=>resolve({data:[],error:null}));expect(screen.getByRole('button',{name:'Xác nhận FUNDED'})).toBeEnabled();expect(screen.queryByText('Không có yêu cầu chờ xác nhận')).not.toBeInTheDocument();
 });
 it('allows a manual funding-list retry after a read error',async()=>{
  f.read.mockResolvedValueOnce({data:null,error:{message:'LOCAL503'}});render(<PendingConfirmTab clubIds={['club']}/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được');fireEvent.click(screen.getByRole('button',{name:'Tải lại danh sách chờ FUNDED'}));
  expect(await screen.findByRole('button',{name:'Xác nhận FUNDED'})).toBeEnabled();expect(screen.queryByRole('alert')).not.toBeInTheDocument();
 });
 it.each(['actor','session','club'])('does not publish a prior-scope funding result after changing %s',async scope=>{
  let resolve!:(v:unknown)=>void;f.invoke.mockImplementation(()=>new Promise(r=>{resolve=r;}));
  const view=render(<PendingConfirmTab clubIds={['club']}/>);fireEvent.click(await screen.findByRole('button',{name:'Xác nhận FUNDED'}));
  if(scope==='actor')f.userId='e5580000-0000-4000-8000-000000000001';if(scope==='session')f.session={access_token:'LOCAL_B'};
  view.rerender(<PendingConfirmTab clubIds={[scope==='club'?'other':'club']}/>);
  await act(async()=>resolve({data:{success:true,purchase_id:purchase,purchase_status:'funded',deal_status:'funded',total_funded_percent:10,total_committed_percent:0},error:null}));
  expect(f.success).not.toHaveBeenCalled();expect(f.error).not.toHaveBeenCalled();
 });
 it('keeps a distinct funding/email result after financial success',async()=>{
  f.invoke.mockResolvedValue({data:{success:true,purchase_id:purchase,purchase_status:'funded',deal_status:'funded',total_funded_percent:10,total_committed_percent:0,
   delivery:{purchase_id:purchase,expected:2,total:2,delivered:1,pending:0,processing:0,needs_attention:1,evidence_missing:false,state:'needs_attention'}},error:null});
  render(<PendingConfirmTab clubIds={['club']}/>);fireEvent.click(await screen.findByRole('button',{name:'Xác nhận FUNDED'}));
  expect(await screen.findByRole('status')).toHaveTextContent('email cần đối chiếu');expect(f.success).toHaveBeenCalledOnce();
 });
 it.each(['reject','sdk_error','business_error'])('ignores a late %s funding failure after session replacement',async fault=>{
  let resolve!:(v:unknown)=>void,reject!:(v:unknown)=>void;f.invoke.mockImplementation(()=>new Promise((r,j)=>{resolve=r;reject=j;}));
  const view=render(<PendingConfirmTab clubIds={['club']}/>);fireEvent.click(await screen.findByRole('button',{name:'Xác nhận FUNDED'}));
  f.session={access_token:'LOCAL_B'};view.rerender(<PendingConfirmTab clubIds={['club']}/>);
  await act(async()=>{if(fault==='reject')reject(new Error('LOCAL late rejection'));else resolve(fault==='sdk_error'?{data:null,error:{message:'LOCAL late error'}}:{data:{error:'LOCAL late business denial'},error:null});});
  expect(f.error).not.toHaveBeenCalled();expect(f.success).not.toHaveBeenCalled();
 });
 it('does not read or submit funding while signed out',()=>{
  f.userId='';render(<PendingConfirmTab clubIds={['club']}/>);expect(screen.getByText('Đăng nhập để kiểm tra yêu cầu FUNDED.')).toBeInTheDocument();expect(f.read).not.toHaveBeenCalled();expect(f.invoke).not.toHaveBeenCalled();
 });
 it('shows server refund amount instead of total deal buy-in',async()=>{
  render(<RefundTab clubIds={['club']}/>);fireEvent.click(await screen.findByRole('button',{name:'Hoàn tiền'}));
  await screen.findByText('110.000 ₫');expect(screen.getByRole('dialog')).not.toHaveTextContent('1.000.000');
  expect(screen.getByRole('dialog')).toHaveTextContent('Dự kiến hoàn tiền theo server');
 });
 it.each(['error','wrong_deal','wrong_club','malformed'])('blocks refund on %s preview without falling back to buy-in',async fault=>{
  f.preview.mockResolvedValue({data:fault==='malformed'?{}:{deal_id:fault==='wrong_deal'?'e5400000-0000-4000-8000-000000000001':deal,
   club_id:fault==='wrong_club'?'other':'club',label:'TEST',state:'eligible',amount_vnd:110000,purchase_count:2},error:fault==='error'?{code:'503'}:null});
  render(<RefundTab clubIds={['club']}/>);fireEvent.click(await screen.findByRole('button',{name:'Hoàn tiền'}));
  fireEvent.change(screen.getByPlaceholderText('Lý do hoàn tiền (bắt buộc)'),{target:{value:'TEST invalid preview'}});
  expect(await screen.findByRole('alert')).toHaveTextContent('Không xác minh được preview');
  expect(screen.getByRole('button',{name:'Xác nhận hoàn tiền'})).toBeDisabled();expect(f.invoke).not.toHaveBeenCalled();
 });
 it.each(['missing','busy'])('does not submit or create a new intent when cross-tab lock is %s',async state=>{
  Object.defineProperty(navigator,'locks',{configurable:true,value:state==='missing'?undefined:{request:async(_name:string,_options:unknown,callback:(lock:unknown)=>unknown)=>callback(null)}});
  render(<RefundTab clubIds={['club']}/>);fireEvent.click(await screen.findByRole('button',{name:'Hoàn tiền'}));
  fireEvent.change(screen.getByPlaceholderText('Lý do hoàn tiền (bắt buộc)'),{target:{value:'TEST cross-tab lock'}});
  await confirmRefund();
  await waitFor(()=>expect(f.error).toHaveBeenCalled());expect(f.invoke).not.toHaveBeenCalled();expect(localStorage.length).toBe(0);
 });
 it('does not present a failed refund-list read as an empty list and allows retry',async()=>{
  f.read.mockResolvedValueOnce({data:null,error:{message:'LOCAL 503'}});
  render(<RefundTab clubIds={['club']}/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được');
  expect(screen.queryByText('Không có deal nào đã funded')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Thử tải lại danh sách hoàn tiền'}));
  expect(await screen.findByRole('button',{name:'Hoàn tiền'})).toBeEnabled();
 });
 it.each(['reject','malformed','profiles'])('keeps an explicit refund read error for %s failure',async failure=>{
  f.read.mockImplementation((table,rows)=>failure==='reject'?Promise.reject(new Error('LOCAL network')):
   failure==='malformed'?{data:{unexpected:true},error:null}:
    table==='staking_deals'?{data:rows.map((r:Record<string,unknown>)=>({...r,player_id:deal})),error:null}:{data:null,error:{message:'LOCAL profiles 503'}});
  render(<RefundTab clubIds={['club']}/>);expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được');
  expect(screen.queryByText('Không có deal nào đã funded')).not.toBeInTheDocument();expect(f.invoke).not.toHaveBeenCalled();
 });
 it('keeps receipt recovery available even while the funded list is pending',async()=>{
  localStorage.setItem(`vinpoker:staking-refund:v1:e5310000-0000-4000-8000-000000000001:${deal}`,JSON.stringify({
   actor_id:'e5310000-0000-4000-8000-000000000001',request_id:'e5340000-0000-4000-8000-000000000001',deal_id:deal,club_id:'club',reason:'TEST pending list'}));
  f.read.mockImplementation(()=>new Promise(()=>{}));render(<RefundTab clubIds={['club']}/>);
  expect(await screen.findByRole('button',{name:'Khôi phục yêu cầu hoàn tiền'})).toBeEnabled();expect(f.invoke).not.toHaveBeenCalled();
 });
 it.each(['pending','forged'])('keeps the original journal after money commit with %s delivery evidence',async scenario=>{
  f.invoke.mockImplementation(async(_name,options)=>({data:{success:true,deal_id:deal,request_id:options.body.request_id,
   refunded_backers:2,ledger_failures:0,delivery:{request_id:options.body.request_id,deal_id:deal,expected:2,total:2,
    delivered:0,pending:2,processing:0,needs_attention:0,evidence_missing:false,state:scenario==='pending'?'pending':'all_delivered'}},error:null}));
  render(<RefundTab clubIds={['club']}/>);fireEvent.click(await screen.findByRole('button',{name:'Hoàn tiền'}));
  fireEvent.change(screen.getByPlaceholderText('Lý do hoàn tiền (bắt buộc)'),{target:{value:'TEST held delivery'}});
  await confirmRefund();
  await waitFor(()=>expect(f.success).toHaveBeenCalled());
  expect(localStorage.getItem(`vinpoker:staking-refund:v1:e5310000-0000-4000-8000-000000000001:${deal}`)).not.toBeNull();
  expect(await screen.findByRole('button',{name:'Khôi phục yêu cầu hoàn tiền'})).toBeEnabled();
  expect(f.warning).toHaveBeenCalled();
 });
 it('reuses the persisted request after lost response and remount, without automatic submission',async()=>{
  f.invoke.mockRejectedValueOnce(new Error('LOCAL response lost')).mockImplementation(async(_name,options)=>({data:{success:true,deal_id:deal,
   request_id:options.body.request_id,refunded_backers:2,ledger_failures:0,delivery:delivered(options.body.request_id)},error:null}));
  const first=render(<RefundTab clubIds={['club']}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Hoàn tiền'}));
  fireEvent.change(screen.getByPlaceholderText('Lý do hoàn tiền (bắt buộc)'),{target:{value:'TEST recovery'}});
  await confirmRefund();
  await waitFor(()=>expect(f.error).toHaveBeenCalled());const original=f.invoke.mock.calls[0][1].body;
  expect(original.request_id).toMatch(/^[a-f0-9-]{36}$/i);first.unmount();
  render(<RefundTab clubIds={['club']}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Khôi phục yêu cầu hoàn tiền'}));
  expect(f.invoke).toHaveBeenCalledTimes(1);
  expect(screen.getByPlaceholderText('Lý do hoàn tiền (bắt buộc)')).toHaveValue('TEST recovery');
  await confirmRefund();
  await waitFor(()=>expect(f.success).toHaveBeenCalled());expect(f.invoke.mock.calls[1][1].body).toEqual(original);
 });
 it('does not send a refund when the durable journal cannot be written',async()=>{
  render(<RefundTab clubIds={['club']}/>);fireEvent.click(await screen.findByRole('button',{name:'Hoàn tiền'}));
  fireEvent.change(screen.getByPlaceholderText('Lý do hoàn tiền (bắt buộc)'),{target:{value:'TEST storage'}});
  const spy=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('LOCAL quota');});
  try{await confirmRefund();
   await waitFor(()=>expect(f.error).toHaveBeenCalled());expect(f.invoke).not.toHaveBeenCalled();}finally{spy.mockRestore();}
 });
 it.each(['funding','refund'])('sends one %s mutation for same-tick double-click',async(kind)=>{
  const releases:Array<(value:unknown)=>void>=[];
  f.invoke.mockImplementation(()=>new Promise(resolve=>{releases.push(resolve);}));
  render(kind==='funding'?<PendingConfirmTab clubIds={['club']}/>:<RefundTab clubIds={['club']}/>);
  if(kind==='refund'){
   fireEvent.click(await screen.findByRole('button',{name:'Hoàn tiền'}));
   fireEvent.change(screen.getByPlaceholderText('Lý do hoàn tiền (bắt buộc)'),{target:{value:'TEST486 correction'}});
  }
  const button=await screen.findByRole('button',{name:kind==='funding'?'Xác nhận FUNDED':'Xác nhận hoàn tiền'});
  await waitFor(()=>expect(button).toBeEnabled());
  act(()=>{fireEvent.click(button);fireEvent.click(button);});
  const sent=f.invoke.mock.calls.length;
  const packet=kind==='funding'?{success:true,purchase_id:purchase,purchase_status:'funded'}
   :{success:true,deal_id:deal,refunded_backers:2,ledger_failures:0};
  await act(async()=>{for(const release of releases)release({data:packet,error:null});});
  expect(sent).toBe(1);
 });
 it.each([null,{}, {success:false}, {success:true,purchase_id:'different',purchase_status:'funded'},
  {success:true,purchase_id:purchase,purchase_status:'committed'}])('does not confirm FUNDED from unverified packet %j',async(data)=>{
  f.invoke.mockResolvedValue({data,error:null});render(<PendingConfirmTab clubIds={['club']}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Xác nhận FUNDED'}));
  await waitFor(()=>expect(f.error).toHaveBeenCalled());expect(f.success).not.toHaveBeenCalled();expect(f.invoke).toHaveBeenCalledTimes(1);
 });
 it.each([false,true])('accepts canonical matching FUNDED confirmation, replay=%s',async(already)=>{
  f.invoke.mockResolvedValue({data:{success:true,already,purchase_id:purchase,purchase_status:'funded',deal_status:'funded',total_funded_percent:10,total_committed_percent:0},error:null});
  render(<PendingConfirmTab clubIds={['club']}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Xác nhận FUNDED'}));
  await waitFor(()=>expect(f.success).toHaveBeenCalled());expect(f.error).not.toHaveBeenCalled();expect(f.invoke).toHaveBeenCalledTimes(1);
 });
 it.each([null,{}, {success:false}, {success:true,deal_id:'different',refunded_backers:2,ledger_failures:0}])('does not confirm refund from unverified packet %j',async(data)=>{
  f.invoke.mockResolvedValue({data,error:null});render(<RefundTab clubIds={['club']}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Hoàn tiền'}));
  fireEvent.change(screen.getByPlaceholderText('Lý do hoàn tiền (bắt buộc)'),{target:{value:'TEST486 correction'}});
  await confirmRefund();
  await waitFor(()=>expect(f.error).toHaveBeenCalled());expect(f.success).not.toHaveBeenCalled();expect(f.invoke).toHaveBeenCalledTimes(1);
 });
 it('reports ledger failures as reconciliation required without repeating the refund',async()=>{
  f.invoke.mockImplementation(async(_name,options)=>({data:{success:true,deal_id:deal,request_id:options.body.request_id,refunded_backers:2,ledger_failures:1,warning:'needs reconciliation'},error:null}));
  render(<RefundTab clubIds={['club']}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Hoàn tiền'}));
  fireEvent.change(screen.getByPlaceholderText('Lý do hoàn tiền (bắt buộc)'),{target:{value:'TEST486 correction'}});
  await confirmRefund();
  await waitFor(()=>expect(f.warning).toHaveBeenCalledWith(expect.stringMatching(/đối chiếu/i)));
  expect(f.success).not.toHaveBeenCalled();expect(f.invoke).toHaveBeenCalledTimes(1);
 });
 it('accepts a matching completed refund with explicit zero ledger failures',async()=>{
  f.invoke.mockImplementation(async(_name,options)=>({data:{success:true,deal_id:deal,request_id:options.body.request_id,refunded_backers:2,ledger_failures:0,delivery:delivered(options.body.request_id)},error:null}));
  render(<RefundTab clubIds={['club']}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Hoàn tiền'}));
  fireEvent.change(screen.getByPlaceholderText('Lý do hoàn tiền (bắt buộc)'),{target:{value:'TEST486 correction'}});
  await confirmRefund();
  await waitFor(()=>expect(f.success).toHaveBeenCalled());expect(f.warning).not.toHaveBeenCalled();expect(f.error).not.toHaveBeenCalled();
  expect(localStorage.getItem(`vinpoker:staking-refund:v1:e5310000-0000-4000-8000-000000000001:${deal}`)).toBeNull();
  expect(f.invoke).toHaveBeenCalledTimes(1);
 });
 it.each([-1,1.5,'0',3])('rejects invalid refund ledger count %s',async(ledger_failures)=>{
  f.invoke.mockResolvedValue({data:{success:true,deal_id:deal,refunded_backers:2,ledger_failures},error:null});
  render(<RefundTab clubIds={['club']}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Hoàn tiền'}));
  fireEvent.change(screen.getByPlaceholderText('Lý do hoàn tiền (bắt buộc)'),{target:{value:'TEST486 correction'}});
  await confirmRefund();
  await waitFor(()=>expect(f.error).toHaveBeenCalled());expect(f.success).not.toHaveBeenCalled();expect(f.warning).not.toHaveBeenCalled();
  expect(f.invoke).toHaveBeenCalledTimes(1);
 });
 it('releases funding loading on a rejected transport without reporting success or retrying',async()=>{
  f.invoke.mockRejectedValue(new Error('LOCAL funding transport unavailable'));render(<PendingConfirmTab clubIds={['club']}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Xác nhận FUNDED'}));
  await waitFor(()=>expect(f.error).toHaveBeenCalledWith('LOCAL funding transport unavailable'));
  expect(screen.getByRole('button',{name:'Xác nhận FUNDED'})).toBeDisabled(); // Unknown write now requires read-only recovery before explicit same-purchase retry.
  expect(f.success).not.toHaveBeenCalled();expect(f.invoke).toHaveBeenCalledTimes(1);
 });
});
