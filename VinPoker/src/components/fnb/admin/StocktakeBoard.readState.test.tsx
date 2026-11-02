import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({session:{access_token:'TEST-local'},read:vi.fn(),rpc:vi.fn(),menuError:false,reload:vi.fn(),invalidate:vi.fn(),signals:[] as AbortSignal[]}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'10000000-0000-4000-8000-000000000001'},session:h.session,loading:false})}));
vi.mock('@tanstack/react-query',()=>({useQueryClient:()=>({invalidateQueries:h.invalidate})}));
vi.mock('@/hooks/useFnbMenu',()=>({useFnbMenu:()=>({data:{ingredients:[{id:'40000000-0000-4000-8000-000000000001',name:'Ingredient TEST',stock_unit:'unit',is_active:true,on_hand:5,avg_unit_cost:1000}]},isLoading:false,isError:h.menuError,refetch:h.reload})}));
vi.mock('sonner',()=>({toast:{error:vi.fn(),success:vi.fn()}}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:(...args:unknown[])=>{const p=h.rpc(...args);return Object.assign(p,{abortSignal:(s:AbortSignal)=>{h.signals.push(s);return p;}});},from:(table:string)=>{const filters:Record<string,string>={};const q={select:(columns:string)=>{filters.__select=columns;return q;},eq:(key:string,value:string)=>{filters[key]=value;return q;},limit:()=>q,maybeSingle:()=>q,abortSignal:(signal:AbortSignal)=>{h.signals.push(signal);return q;},then:(resolve:(x:unknown)=>unknown,reject:(x:unknown)=>unknown)=>h.read(table,filters).then(resolve,reject)};return q;}}}));
import {StocktakeBoard} from './StocktakeBoard';
import {readStocktakeLineHold,writeStocktakeLineHold,stocktakeLineHoldKey} from '@/lib/fnbStocktakeLineHold';
import {readStocktakeOperation,writeStocktakeOperation,stocktakeOperationKey,type StocktakeOperationIntent} from '@/lib/fnbStocktakeOperationIntent';
import {toast} from 'sonner';
beforeEach(()=>{localStorage.clear();vi.stubEnv('VITE_SUPABASE_URL','http://127.0.0.1:54329');Object.defineProperty(navigator,'locks',{configurable:true,value:{request:vi.fn(async(_key:string,optionsOrWork:unknown,work?:()=>unknown)=>(work??optionsOrWork as ()=>unknown)())}});h.menuError=false;h.signals=[];h.reload.mockReset();h.invalidate.mockReset();h.read.mockReset().mockImplementation(async(table:string)=>({data:table==='fnb_stocktakes'?null:[],error:null}));h.rpc.mockReset().mockResolvedValue({data:{status:'ok',stocktake_id:'30000000-0000-4000-8000-000000000003',idempotent:false},error:null});});
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllEnvs();});
it('in-app confirmation shows the saved counts and cancel sends no stock operation',async()=>{
 openBoard();const native=vi.spyOn(window,'confirm').mockReturnValue(false);render(<StocktakeBoard clubId={recoveryOpen.clubId}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Chốt kiểm kho'}));
 expect(await screen.findByRole('alertdialog')).toHaveTextContent('Xác nhận chốt kiểm kho');
 expect(screen.getByRole('alertdialog')).toHaveTextContent('Ingredient TEST');
 expect(screen.getByRole('alertdialog')).toHaveTextContent('3 unit');
 expect(h.rpc).not.toHaveBeenCalled();expect(native).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Quay lại'}));
 expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();expect(h.rpc).not.toHaveBeenCalled();
 expect(readStocktakeOperation(localStorage,recoveryOpen.actorId,recoveryOpen.clubId,recoveryOpen.backend)).toBeNull();
});
it('in-app confirmation submits the reviewed saved counts only after explicit acceptance',async()=>{
 openBoard();vi.spyOn(window,'confirm').mockReturnValue(false);h.rpc.mockImplementation(()=>new Promise(()=>{}));render(<StocktakeBoard clubId={recoveryOpen.clubId}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Chốt kiểm kho'}));
 const accept=await screen.findByRole('button',{name:'Xác nhận chốt'});
 expect(h.rpc).not.toHaveBeenCalled();act(()=>{fireEvent.click(accept);fireEvent.click(accept);});
 expect(h.rpc).toHaveBeenCalledTimes(1);expect(h.rpc).toHaveBeenCalledWith('fnb_commit_stocktake_confirmed_v1',{
  p_stocktake_id:recoveryRow.id,p_expected_counts:{'40000000-0000-4000-8000-000000000001':'3'},
 });
 expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
});
it('in-app confirmation is invalidated when another operation changes the journal',async()=>{
 openBoard();vi.spyOn(window,'confirm').mockReturnValue(false);render(<StocktakeBoard clubId={recoveryOpen.clubId}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Chốt kiểm kho'}));await screen.findByRole('alertdialog');
 const peer:StocktakeOperationIntent={...recoveryOpen,requestId:'50000000-0000-4000-8000-000000000099',kind:'commit',sessionId:recoveryRow.id,counts:{'40000000-0000-4000-8000-000000000001':'4'}};
 writeStocktakeOperation(localStorage,peer);act(()=>window.dispatchEvent(new StorageEvent('storage',{key:stocktakeOperationKey(peer.actorId,peer.clubId,peer.backend)})));
 await waitFor(()=>expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
 expect(h.rpc).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'Chốt kiểm kho'})).toBeDisabled();
 expect(readStocktakeOperation(localStorage,peer.actorId,peer.clubId,peer.backend)?.intent.requestId).toBe(peer.requestId);
});
it('in-app confirmation does not survive a change of club',async()=>{
 openBoard();vi.spyOn(window,'confirm').mockReturnValue(false);const view=render(<StocktakeBoard clubId={recoveryOpen.clubId}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Chốt kiểm kho'}));await screen.findByRole('alertdialog');
 view.rerender(<StocktakeBoard clubId="20000000-0000-4000-8000-000000000002"/>);
 await screen.findByDisplayValue('3');expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();expect(h.rpc).not.toHaveBeenCalled();
 expect(localStorage.length).toBe(0);
});
const acceptCommit=()=>{fireEvent.click(screen.getByRole('button',{name:'Chốt kiểm kho'}));fireEvent.click(screen.getByRole('button',{name:'Xác nhận chốt'}));};
it.each([
 {status:'ok',committed:true,adjusted_lines:1},
 {status:'ok',committed:true,adjusted_lines:1,counts_confirmed:false,stocktake_id:'30000000-0000-4000-8000-000000000001'},
 {status:'ok',committed:true,adjusted_lines:1,counts_confirmed:true,stocktake_id:'30000000-0000-4000-8000-000000000002'},
])('keeps a malformed snapshot-command acknowledgement unknown: %j',async(reply)=>{
 openBoard();vi.mocked(toast.error).mockClear();h.rpc.mockResolvedValue({data:reply,error:null});render(<StocktakeBoard clubId={recoveryOpen.clubId}/>);
 await screen.findByRole('button',{name:'Chốt kiểm kho'});acceptCommit();await act(async()=>{});
 expect(toast.error).toHaveBeenCalledWith('Chưa xác minh kết quả kiểm kho. Giữ yêu cầu gốc; không tự gửi lại.');
 expect(screen.queryByText('Máy chủ đã phản hồi chốt phiên. Cần đối chiếu số đếm đã chốt trước khi xác nhận hoàn tất.')).not.toBeInTheDocument();
 expect(readStocktakeOperation(localStorage,recoveryOpen.actorId,recoveryOpen.clubId,recoveryOpen.backend)?.state).toBe('pending');expect(h.rpc).toHaveBeenCalledTimes(1);
});
it('requires canonical READ after a valid snapshot-command acknowledgement',async()=>{
 openBoard();vi.mocked(toast.success).mockClear();h.rpc.mockResolvedValue({data:{status:'ok',committed:true,adjusted_lines:1,counts_confirmed:true,stocktake_id:recoveryRow.id},error:null});render(<StocktakeBoard clubId={recoveryOpen.clubId}/>);
 await screen.findByRole('button',{name:'Chốt kiểm kho'});acceptCommit();await act(async()=>{});
 expect(screen.getByText('Máy chủ đã phản hồi chốt phiên. Cần đối chiếu số đếm đã chốt trước khi xác nhận hoàn tất.')).toBeInTheDocument();
 expect(readStocktakeOperation(localStorage,recoveryOpen.actorId,recoveryOpen.clubId,recoveryOpen.backend)?.state).toBe('pending');expect(toast.success).not.toHaveBeenCalled();expect(h.read).toHaveBeenCalledTimes(2);
});
const openBoard=()=>h.read.mockImplementation(async(table:string)=>({data:table==='fnb_stocktakes'?{id:'30000000-0000-4000-8000-000000000001'}:[{ingredient_id:'40000000-0000-4000-8000-000000000001',counted_qty:3}],error:null}));
const recoveryOpen:StocktakeOperationIntent={actorId:'10000000-0000-4000-8000-000000000001',clubId:'20000000-0000-4000-8000-000000000001',backend:'http://127.0.0.1:54329',requestId:'50000000-0000-4000-8000-000000000001',kind:'open'};
const recoveryRow={id:'30000000-0000-4000-8000-000000000001',club_id:recoveryOpen.clubId,client_request_id:recoveryOpen.requestId,note:null,status:'open',created_by:recoveryOpen.actorId,created_at:'2026-10-27T01:00:00Z',committed_by:null,committed_at:null};
it('reloads current counts after an explicit no-write rejection and requires a new manual confirmation',async()=>{
 openBoard();vi.mocked(toast.success).mockClear();
 h.rpc.mockImplementation(async()=>{h.read.mockImplementation(async(table:string)=>({data:table==='fnb_stocktakes'?{id:recoveryRow.id}:[{ingredient_id:'40000000-0000-4000-8000-000000000001',counted_qty:4}],error:null}));return {data:{error:'STOCKTAKE_COUNTS_CHANGED'},error:null};});
 const first=render(<StocktakeBoard clubId={recoveryOpen.clubId}/>);await screen.findByRole('button',{name:'Chốt kiểm kho'});acceptCommit();await act(async()=>{});
 expect(await screen.findByDisplayValue('4')).toBeInTheDocument();expect(readStocktakeOperation(localStorage,recoveryOpen.actorId,recoveryOpen.clubId,recoveryOpen.backend)?.state).toBe('counts_changed');expect(h.rpc).toHaveBeenCalledTimes(1);expect(toast.success).not.toHaveBeenCalled();
 first.unmount();render(<StocktakeBoard clubId={recoveryOpen.clubId}/>);await screen.findByDisplayValue('4');expect(screen.getByRole('button',{name:'Chốt kiểm kho'})).toBeEnabled();expect(screen.getByRole('alert')).toHaveTextContent('Yêu cầu trước bị từ chối');expect(h.rpc).toHaveBeenCalledTimes(1);
 acceptCommit();await act(async()=>{});expect(h.rpc).toHaveBeenCalledTimes(2);expect(h.rpc.mock.calls[1][1].p_expected_counts).toEqual({'40000000-0000-4000-8000-000000000001':'4'});
});
it.each([
 {data:{error:'STOCKTAKE_COUNTS_CHANGED'},error:{message:'transport failed'}},
 {data:{error:'STOCKTAKE_COUNTS_CHANGED',committed:true},error:null},
 {data:null,error:null},
])('does not release an unknown or inconsistent commit result: %j',async(reply)=>{
 openBoard();h.rpc.mockResolvedValue(reply);render(<StocktakeBoard clubId={recoveryOpen.clubId}/>);await screen.findByRole('button',{name:'Chốt kiểm kho'});acceptCommit();await act(async()=>{});
 expect(readStocktakeOperation(localStorage,recoveryOpen.actorId,recoveryOpen.clubId,recoveryOpen.backend)?.state).toBe('pending');expect(screen.getByRole('button',{name:'Chốt kiểm kho'})).toBeDisabled();expect(h.read).toHaveBeenCalledTimes(2);expect(h.rpc).toHaveBeenCalledTimes(1);
});
it('does not enable another commit when refreshing after rejection fails',async()=>{
 openBoard();h.rpc.mockImplementation(async()=>{h.read.mockResolvedValue({data:null,error:{message:'503'}});return {data:{error:'STOCKTAKE_COUNTS_CHANGED'},error:null};});render(<StocktakeBoard clubId={recoveryOpen.clubId}/>);await screen.findByRole('button',{name:'Chốt kiểm kho'});acceptCommit();await act(async()=>{});
 expect(screen.getByRole('alert')).toHaveTextContent('Không tải được phiên kiểm kho');expect(screen.queryByRole('button',{name:'Chốt kiểm kho'})).not.toBeInTheDocument();expect(h.rpc).toHaveBeenCalledTimes(1);
});
it('keeps the pending hold if a known rejection cannot be persisted',async()=>{
 openBoard();h.rpc.mockImplementation(async()=>{vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('TEST rejection write failed');});return {data:{error:'STOCKTAKE_COUNTS_CHANGED'},error:null};});render(<StocktakeBoard clubId={recoveryOpen.clubId}/>);await screen.findByRole('button',{name:'Chốt kiểm kho'});acceptCommit();await act(async()=>{});
 expect(readStocktakeOperation(localStorage,recoveryOpen.actorId,recoveryOpen.clubId,recoveryOpen.backend)?.state).toBe('pending');expect(screen.getByRole('button',{name:'Chốt kiểm kho'})).toBeDisabled();expect(h.read).toHaveBeenCalledTimes(2);expect(h.rpc).toHaveBeenCalledTimes(1);
});
it.each([false,true])('explicitly recovers the exact saved open request by READ only, menuUnavailable=%s',async(menuError)=>{
 h.menuError=menuError;writeStocktakeOperation(localStorage,recoveryOpen);h.read.mockImplementation(async(table:string,f:Record<string,string>)=>({data:table==='fnb_stocktakes'?(f.client_request_id?recoveryRow:{id:recoveryRow.id}):[],error:null}));render(<StocktakeBoard clubId={recoveryOpen.clubId}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Đối chiếu yêu cầu kiểm kho'}));await act(async()=>{});expect(readStocktakeOperation(localStorage,recoveryOpen.actorId,recoveryOpen.clubId,recoveryOpen.backend)?.state).toBe('settled');expect(h.rpc).not.toHaveBeenCalled();
});
it('recovers a committed exact session/count snapshot without dispatching a commit',async()=>{
 const intent:StocktakeOperationIntent={...recoveryOpen,kind:'commit',sessionId:recoveryRow.id,counts:{'40000000-0000-4000-8000-000000000001':'4'}};writeStocktakeOperation(localStorage,intent);
 h.read.mockImplementation(async(table:string,f:Record<string,string>)=>table==='fnb_stocktakes'?{data:f.id?{...recoveryRow,status:'committed',committed_by:recoveryOpen.actorId,committed_at:'2026-10-27T02:00:00Z'}:null,error:null}:{data:[{stocktake_id:recoveryRow.id,club_id:recoveryOpen.clubId,ingredient_id:'40000000-0000-4000-8000-000000000001',counted_qty:'4',expected_qty:'5',delta_applied:'-1'}],count:1,error:null});render(<StocktakeBoard clubId={intent.clubId}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Đối chiếu yêu cầu kiểm kho'}));await act(async()=>{});expect(readStocktakeOperation(localStorage,intent.actorId,intent.clubId,intent.backend)?.state).toBe('settled');expect(h.rpc).not.toHaveBeenCalled();expect(h.read.mock.calls.some(([table,f])=>table==='fnb_stocktake_lines'&&f.__select.includes('counted_qty::text'))).toBe(true);
});
it('retains the frozen request when the exact recovery read finds no matching record',async()=>{
 writeStocktakeOperation(localStorage,recoveryOpen);render(<StocktakeBoard clubId={recoveryOpen.clubId}/>);fireEvent.click(await screen.findByRole('button',{name:'Đối chiếu yêu cầu kiểm kho'}));await act(async()=>{});expect(readStocktakeOperation(localStorage,recoveryOpen.actorId,recoveryOpen.clubId,recoveryOpen.backend)?.state).toBe('pending');expect(screen.getByRole('alert')).toHaveTextContent('Chưa tìm thấy biên nhận khớp');expect(h.rpc).not.toHaveBeenCalled();
});
it('bounds a hanging explicit recovery read, suppresses duplicate reads and keeps the journal',async()=>{
 writeStocktakeOperation(localStorage,recoveryOpen);h.read.mockImplementation(async(table:string,f:Record<string,string>)=>f.client_request_id?new Promise(()=>{}):{data:table==='fnb_stocktakes'?null:[],error:null});render(<StocktakeBoard clubId={recoveryOpen.clubId}/>);const read=await screen.findByRole('button',{name:'Đối chiếu yêu cầu kiểm kho'});vi.useFakeTimers();act(()=>{fireEvent.click(read);fireEvent.click(read);});await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});expect(h.read.mock.calls.filter(([,f])=>f.client_request_id).length).toBe(1);expect(screen.getByRole('alert')).toHaveTextContent('Chưa xác minh');expect(readStocktakeOperation(localStorage,recoveryOpen.actorId,recoveryOpen.clubId,recoveryOpen.backend)?.state).toBe('pending');expect(h.rpc).not.toHaveBeenCalled();expect(h.signals.at(-1)?.aborted).toBe(true);
});
it('does not let an older recovery read settle or erase a newer journal request',async()=>{
 writeStocktakeOperation(localStorage,recoveryOpen);let finish!:(x:unknown)=>void;h.read.mockImplementation(async(table:string,f:Record<string,string>)=>f.client_request_id?new Promise(r=>{finish=r;}):{data:table==='fnb_stocktakes'?null:[],error:null});render(<StocktakeBoard clubId={recoveryOpen.clubId}/>);fireEvent.click(await screen.findByRole('button',{name:'Đối chiếu yêu cầu kiểm kho'}));await act(async()=>{});
 const newer:StocktakeOperationIntent={...recoveryOpen,requestId:'50000000-0000-4000-8000-000000000002'};act(()=>{writeStocktakeOperation(localStorage,recoveryOpen,true);writeStocktakeOperation(localStorage,newer);window.dispatchEvent(new StorageEvent('storage',{key:stocktakeOperationKey(newer.actorId,newer.clubId,newer.backend)}));});
 await act(async()=>finish({data:recoveryRow,error:null}));expect(readStocktakeOperation(localStorage,newer.actorId,newer.clubId,newer.backend)).toEqual({state:'pending',intent:newer});expect(h.rpc).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toHaveTextContent(newer.requestId);
});
it('bounds a hung open request and keeps its outcome unknown without retrying a new request',async()=>{
 let held=false;Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_key:string,work:()=>Promise<void>)=>{held=true;try{await work();}finally{held=false;}}}});
 h.rpc.mockImplementation(()=>new Promise(()=>{}));render(<StocktakeBoard clubId="20000000-0000-4000-8000-000000000001"/>);const create=await screen.findByRole('button',{name:'Tạo phiên kiểm kho'});vi.useFakeTimers();fireEvent.click(create);expect(held).toBe(true);await act(async()=>{await vi.advanceTimersByTimeAsync(20001);});expect(held).toBe(false);
 expect(screen.getByRole('alert')).toHaveTextContent('Yêu cầu mở phiên chưa được đối chiếu');expect(h.rpc).toHaveBeenCalledTimes(1);expect(h.signals.at(-1)?.aborted).toBe(true);
});
it.each(['open','commit'] as const)('handles a thrown %s transport rejection without an unhandled promise or automatic retry',async(kind)=>{
 if(kind==='commit')openBoard();h.rpc.mockRejectedValue(new Error('TEST transport rejected'));render(<StocktakeBoard clubId="20000000-0000-4000-8000-000000000001"/>);
 const button=await screen.findByRole('button',{name:kind==='open'?'Tạo phiên kiểm kho':'Chốt kiểm kho'});fireEvent.click(button);if(kind==='commit')fireEvent.click(screen.getByRole('button',{name:'Xác nhận chốt'}));await act(async()=>{});expect(screen.getByRole('alert')).toHaveTextContent(kind==='open'?'Yêu cầu mở phiên chưa được đối chiếu':'Yêu cầu chốt phiên chưa được đối chiếu');expect(h.rpc).toHaveBeenCalledTimes(1);expect(h.signals.at(-1)?.aborted).toBe(true);
});
it('persists the exact open request before dispatch and suppresses two immediate create clicks',async()=>{
 let opened=false,finish!:(x:unknown)=>void;h.read.mockImplementation(async(table:string)=>({data:table==='fnb_stocktakes'?(opened?{id:'30000000-0000-4000-8000-000000000003'}:null):[],error:null}));h.rpc.mockImplementation((_name:string,args:Record<string,unknown>)=>{const saved=readStocktakeOperation(localStorage,'10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','http://127.0.0.1:54329');expect(saved?.state).toBe('pending');expect(saved?.intent.requestId).toBe(args.p_client_request_id);opened=true;return new Promise(r=>{finish=r;});});render(<StocktakeBoard clubId="20000000-0000-4000-8000-000000000001"/>);const button=await screen.findByRole('button',{name:'Tạo phiên kiểm kho'});act(()=>{fireEvent.click(button);fireEvent.click(button);});expect(h.rpc).toHaveBeenCalledTimes(1);await act(async()=>finish({data:{status:'ok',stocktake_id:'30000000-0000-4000-8000-000000000003',idempotent:false},error:null}));expect(readStocktakeOperation(localStorage,'10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','http://127.0.0.1:54329')?.state).toBe('settled');
});
it.each([{status:'ok',idempotent:true},{status:'ok',committed:true,adjusted_lines:1}])('requires exact READ proof after a recognized commit acknowledgement %j',async(reply)=>{
 openBoard();vi.mocked(toast.success).mockClear();h.rpc.mockResolvedValue({data:reply,error:null});render(<StocktakeBoard clubId="20000000-0000-4000-8000-000000000001"/>);await screen.findByRole('button',{name:'Chốt kiểm kho'});acceptCommit();await act(async()=>{});
 expect(toast.success).not.toHaveBeenCalled();expect(h.invalidate).not.toHaveBeenCalled();expect(readStocktakeOperation(localStorage,recoveryOpen.actorId,recoveryOpen.clubId,recoveryOpen.backend)?.state).toBe('pending');expect(screen.getByRole('button',{name:'Đối chiếu yêu cầu kiểm kho'})).toBeEnabled();expect(h.rpc).toHaveBeenCalledTimes(1);
});

it('retains an unknown open request across remount rather than issuing a new UUID',async()=>{
 h.rpc.mockResolvedValue({data:null,error:{message:'503'}});const first=render(<StocktakeBoard clubId="20000000-0000-4000-8000-000000000001"/>);fireEvent.click(await screen.findByRole('button',{name:'Tạo phiên kiểm kho'}));await act(async()=>{});first.unmount();h.rpc.mockClear();render(<StocktakeBoard clubId="20000000-0000-4000-8000-000000000001"/>);
 expect(await screen.findByRole('button',{name:'Tạo phiên kiểm kho'})).toBeDisabled();expect(screen.getByRole('alert')).toHaveTextContent('Yêu cầu mở phiên chưa được đối chiếu');expect(h.rpc).not.toHaveBeenCalled();
});
it('bounds a hung commit and retains the exact session hold across remount',async()=>{
 openBoard();h.rpc.mockImplementation(()=>new Promise(()=>{}));const first=render(<StocktakeBoard clubId="20000000-0000-4000-8000-000000000001"/>);await screen.findByDisplayValue('3');vi.useFakeTimers();acceptCommit();await act(async()=>{await vi.advanceTimersByTimeAsync(20001);});expect(screen.getByRole('alert')).toHaveTextContent('Yêu cầu chốt phiên chưa được đối chiếu');vi.useRealTimers();first.unmount();h.rpc.mockClear();render(<StocktakeBoard clubId="20000000-0000-4000-8000-000000000001"/>);await screen.findByDisplayValue('3');expect(screen.getByRole('button',{name:'Chốt kiểm kho'})).toBeDisabled();expect(h.rpc).not.toHaveBeenCalled();
});
it('does not call a malformed commit acknowledgement a successful zero-adjustment close',async()=>{
 openBoard();h.rpc.mockResolvedValue({data:{status:'ok',committed:true,adjusted_lines:null},error:null});render(<StocktakeBoard clubId="20000000-0000-4000-8000-000000000001"/>);await screen.findByDisplayValue('3');acceptCommit();await act(async()=>{});expect(h.invalidate).not.toHaveBeenCalled();expect(h.read).toHaveBeenCalledTimes(2);expect(screen.getByRole('alert')).toHaveTextContent('Yêu cầu chốt phiên chưa được đối chiếu');
});
it('keeps an unknown line write held after remount even when the server still shows its older count',async()=>{
 openBoard();h.rpc.mockResolvedValue({data:null,error:{message:'503'}});const first=render(<StocktakeBoard clubId="20000000-0000-4000-8000-000000000001"/>);const input=await screen.findByDisplayValue('3');fireEvent.change(input,{target:{value:'4'}});fireEvent.blur(input);await act(async()=>{});first.unmount();h.rpc.mockClear();
 render(<StocktakeBoard clubId="20000000-0000-4000-8000-000000000001"/>);await screen.findByDisplayValue('3');expect(screen.getByRole('button',{name:'Chốt kiểm kho'})).toBeDisabled();expect(screen.getByRole('alert')).toHaveTextContent('Yêu cầu lưu số đếm chưa được đối chiếu');expect(h.rpc).not.toHaveBeenCalled();
});
it('does not release an older board when another tab settles the journal it initially observed pending',async()=>{
 openBoard();const intent={actorId:'10000000-0000-4000-8000-000000000001',clubId:'20000000-0000-4000-8000-000000000001',backend:'http://127.0.0.1:54329',requestId:'50000000-0000-4000-8000-000000000001',sessionId:'30000000-0000-4000-8000-000000000001',ingredientId:'40000000-0000-4000-8000-000000000001',countedQty:4};writeStocktakeLineHold(localStorage,intent);render(<StocktakeBoard clubId={intent.clubId}/>);await screen.findByDisplayValue('3');
 act(()=>{writeStocktakeLineHold(localStorage,intent,true);window.dispatchEvent(new StorageEvent('storage',{key:stocktakeLineHoldKey(intent.actorId,intent.clubId,intent.backend)}));});expect(screen.getByRole('button',{name:'Chốt kiểm kho'})).toBeDisabled();expect(screen.getByRole('alert')).toHaveTextContent('phiên khác');expect(h.rpc).not.toHaveBeenCalled();
});
it('does not dispatch a line writer when the pending intent cannot be persisted',async()=>{
 openBoard();render(<StocktakeBoard clubId="20000000-0000-4000-8000-000000000001"/>);const input=await screen.findByDisplayValue('3');vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('TEST storage unavailable');});fireEvent.change(input,{target:{value:'4'}});fireEvent.blur(input);await act(async()=>{});expect(h.rpc).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'Chốt kiểm kho'})).toBeDisabled();
});
it('does not create a new session while a persisted line hold belongs to an older session no longer returned as open',async()=>{
 const intent={actorId:'10000000-0000-4000-8000-000000000001',clubId:'20000000-0000-4000-8000-000000000001',backend:'http://127.0.0.1:54329',requestId:'50000000-0000-4000-8000-000000000001',sessionId:'30000000-0000-4000-8000-000000000001',ingredientId:'40000000-0000-4000-8000-000000000001',countedQty:4};writeStocktakeLineHold(localStorage,intent);render(<StocktakeBoard clubId={intent.clubId}/>);
 expect(await screen.findByRole('button',{name:'Tạo phiên kiểm kho'})).toBeDisabled();expect(screen.getByRole('alert')).toHaveTextContent(intent.sessionId);expect(h.rpc).not.toHaveBeenCalled();
});
it('holds commit while a changed counted line is still saving, then accepts only its exact acknowledgement',async()=>{
 openBoard();let finish!:(x:unknown)=>void;h.rpc.mockImplementation(()=>new Promise(r=>{finish=r;}));render(<StocktakeBoard clubId="20000000-0000-4000-8000-000000000001"/>);
 const count=await screen.findByDisplayValue('3');fireEvent.change(count,{target:{value:'4'}});fireEvent.blur(count);
 expect(screen.getByRole('button',{name:'Chốt kiểm kho'})).toBeDisabled();
 await act(async()=>finish({data:{status:'ok',stocktake_id:'30000000-0000-4000-8000-000000000001',ingredient_id:'40000000-0000-4000-8000-000000000001',counted_qty:4},error:null}));
 expect(screen.getByRole('button',{name:'Chốt kiểm kho'})).toBeEnabled();expect(h.rpc).toHaveBeenCalledTimes(1);
});
it('does not commit an edited draft before it has been saved',async()=>{
 openBoard();render(<StocktakeBoard clubId="20000000-0000-4000-8000-000000000001"/>);fireEvent.change(await screen.findByDisplayValue('3'),{target:{value:'4'}});
 expect(screen.getByRole('button',{name:'Chốt kiểm kho'})).toBeDisabled();expect(h.rpc).not.toHaveBeenCalled();
});
it.each([{data:null,error:{message:'503'}},{data:{status:'ok',stocktake_id:'30000000-0000-4000-8000-000000000001',ingredient_id:'40000000-0000-4000-8000-000000000001',counted_qty:999},error:null}])('keeps the counted draft and holds commit after an unverified line result %j',async(reply)=>{
 openBoard();h.rpc.mockResolvedValue(reply);render(<StocktakeBoard clubId="20000000-0000-4000-8000-000000000001"/>);const count=await screen.findByDisplayValue('3');fireEvent.change(count,{target:{value:'4'}});fireEvent.blur(count);await act(async()=>{});
 expect(screen.getByDisplayValue('4')).toBeInTheDocument();expect(screen.getByRole('button',{name:'Chốt kiểm kho'})).toBeDisabled();expect(screen.getByRole('alert')).toHaveTextContent('Chưa xác minh');expect(h.rpc).toHaveBeenCalledTimes(1);
});
it('bounds a lost line response, aborts transport, and keeps the unknown count held without an automatic retry',async()=>{
 openBoard();h.rpc.mockImplementation(()=>new Promise(()=>{}));render(<StocktakeBoard clubId="20000000-0000-4000-8000-000000000001"/>);const input=await screen.findByDisplayValue('3');vi.useFakeTimers();fireEvent.change(input,{target:{value:'4'}});fireEvent.blur(input);
 await act(async()=>{await vi.advanceTimersByTimeAsync(20001);});
 expect(screen.getByDisplayValue('4')).toBeDisabled();expect(screen.getByRole('alert')).toHaveTextContent('Cần quản lý đối chiếu');expect(screen.getByRole('button',{name:'Chốt kiểm kho'})).toBeDisabled();expect(h.rpc).toHaveBeenCalledTimes(1);expect(h.signals.at(-1)?.aborted).toBe(true);
});
it('does not let a prior club line completion unlock the currently saving club',async()=>{
 h.read.mockImplementation(async(table:string,f:Record<string,string>)=>({data:table==='fnb_stocktakes'?{id:f.club_id==='20000000-0000-4000-8000-000000000001'?'30000000-0000-4000-8000-000000000001':'30000000-0000-4000-8000-000000000002'}:[{ingredient_id:'40000000-0000-4000-8000-000000000001',counted_qty:3}],error:null}));
 const finish:Array<(x:unknown)=>void>=[];h.rpc.mockImplementation(()=>new Promise(r=>finish.push(r)));const view=render(<StocktakeBoard clubId="20000000-0000-4000-8000-000000000001"/>);let input=await screen.findByDisplayValue('3');fireEvent.change(input,{target:{value:'4'}});fireEvent.blur(input);
 view.rerender(<StocktakeBoard clubId="20000000-0000-4000-8000-000000000002"/>);input=await screen.findByDisplayValue('3');fireEvent.change(input,{target:{value:'5'}});fireEvent.blur(input);
 await act(async()=>finish[0]({data:{status:'ok',stocktake_id:'30000000-0000-4000-8000-000000000001',ingredient_id:'40000000-0000-4000-8000-000000000001',counted_qty:4},error:null}));expect(screen.getByRole('button',{name:'Chốt kiểm kho'})).toBeDisabled();expect(screen.getByDisplayValue('5')).toBeDisabled();
 expect(readStocktakeLineHold(localStorage,'10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','http://127.0.0.1:54329')?.state).toBe('settled');
 await act(async()=>finish[1]({data:{status:'ok',stocktake_id:'30000000-0000-4000-8000-000000000002',ingredient_id:'40000000-0000-4000-8000-000000000001',counted_qty:5},error:null}));expect(screen.getByRole('button',{name:'Chốt kiểm kho'})).toBeEnabled();
});
it('does not treat clearing an already saved count as a confirmed removal of that server line',async()=>{
 openBoard();render(<StocktakeBoard clubId="20000000-0000-4000-8000-000000000001"/>);const input=await screen.findByDisplayValue('3');fireEvent.change(input,{target:{value:''}});fireEvent.blur(input);expect(screen.getByRole('button',{name:'Chốt kiểm kho'})).toBeDisabled();expect(h.rpc).not.toHaveBeenCalled();
});
it('does not use lossy numeric equality to mark an edited unblurred draft as already saved',async()=>{
 h.read.mockImplementation(async(table:string)=>({data:table==='fnb_stocktakes'?{id:'30000000-0000-4000-8000-000000000001'}:[{ingredient_id:'40000000-0000-4000-8000-000000000001',counted_qty:'9007199254740992'}],error:null}));render(<StocktakeBoard clubId="20000000-0000-4000-8000-000000000001"/>);
 fireEvent.change(await screen.findByDisplayValue('9007199254740992'),{target:{value:'9007199254740993'}});expect(screen.getByRole('button',{name:'Chốt kiểm kho'})).toBeDisabled();expect(h.rpc).not.toHaveBeenCalled();
});
it('permits a verified unchanged board to commit once under two immediate clicks',async()=>{
 openBoard();let finish!:(x:unknown)=>void;h.rpc.mockImplementation(()=>new Promise(r=>{finish=r;}));render(<StocktakeBoard clubId="20000000-0000-4000-8000-000000000001"/>);await screen.findByDisplayValue('3');
 const commit=screen.getByRole('button',{name:'Chốt kiểm kho'});act(()=>{fireEvent.click(commit);fireEvent.click(commit);});const accept=screen.getByRole('button',{name:'Xác nhận chốt'});act(()=>{fireEvent.click(accept);fireEvent.click(accept);});expect(h.rpc).toHaveBeenCalledTimes(1);expect(h.rpc).toHaveBeenCalledWith('fnb_commit_stocktake_confirmed_v1',{p_stocktake_id:'30000000-0000-4000-8000-000000000001',p_expected_counts:{'40000000-0000-4000-8000-000000000001':'3'}});
 await act(async()=>finish({data:{status:'ok',committed:true,adjusted_lines:0},error:null}));
});
it('does not offer a new session after a failed session read',async()=>{
 h.read.mockResolvedValue({data:null,error:{message:'offline'}});render(<StocktakeBoard clubId="20000000-0000-4000-8000-000000000001"/>);await screen.findByText(/Chưa có phiên kiểm kho|Không tải được phiên kiểm kho/);const create=screen.queryByRole('button',{name:'Tạo phiên kiểm kho'});if(create)fireEvent.click(create);expect(h.rpc).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toHaveTextContent('Không tải được phiên kiểm kho');
});
it('rejects null lines instead of presenting an empty verified open session',async()=>{
 h.read.mockImplementation(async(table:string)=>({data:table==='fnb_stocktakes'?{id:'30000000-0000-4000-8000-000000000001'}:null,error:null}));render(<StocktakeBoard clubId="20000000-0000-4000-8000-000000000001"/>);await waitFor(()=>expect(h.read).toHaveBeenCalledTimes(2));await act(async()=>{});expect(screen.queryByRole('button',{name:'Chốt kiểm kho'})).not.toBeInTheDocument();expect(screen.getByRole('alert')).toHaveTextContent('Không tải được phiên kiểm kho');
});
it('preserves a verified no-open-session state',async()=>{render(<StocktakeBoard clubId="20000000-0000-4000-8000-000000000001"/>);expect(await screen.findByRole('button',{name:'Tạo phiên kiểm kho'})).toBeEnabled();expect(screen.queryByRole('alert')).not.toBeInTheDocument();});
it('ignores a prior board reply after selecting another club',async()=>{
 let finish!:(x:unknown)=>void;h.read.mockImplementation((table:string,f:Record<string,string>)=>table==='fnb_stocktakes'?(f.club_id==='20000000-0000-4000-8000-000000000001'?new Promise(r=>{finish=r;}):Promise.resolve({data:{id:'30000000-0000-4000-8000-000000000002'},error:null})):Promise.resolve({data:[{ingredient_id:'40000000-0000-4000-8000-000000000001',counted_qty:f.stocktake_id==='30000000-0000-4000-8000-000000000002'?2:99}],error:null}));const v=render(<StocktakeBoard clubId="20000000-0000-4000-8000-000000000001"/>);await waitFor(()=>expect(h.read).toHaveBeenCalledTimes(1));v.rerender(<StocktakeBoard clubId="20000000-0000-4000-8000-000000000002"/>);await screen.findByDisplayValue('2');await act(async()=>{finish({data:{id:'30000000-0000-4000-8000-000000000001'},error:null});});expect(screen.getByDisplayValue('2')).toBeInTheDocument();expect(screen.queryByDisplayValue('99')).not.toBeInTheDocument();fireEvent.blur(screen.getByDisplayValue('2'));await waitFor(()=>expect(h.rpc).toHaveBeenCalledWith('fnb_set_stocktake_line',{p_stocktake_id:'30000000-0000-4000-8000-000000000002',p_ingredient_id:'40000000-0000-4000-8000-000000000001',p_counted_qty:2}));
});
it('bounds a hanging session read and retries explicitly without opening a session',async()=>{
 vi.useFakeTimers();let finish!:(x:unknown)=>void;h.read.mockImplementationOnce(()=>new Promise(r=>{finish=r;}));render(<StocktakeBoard clubId="20000000-0000-4000-8000-000000000001"/>);await act(async()=>{});await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});expect(screen.getByRole('alert')).toHaveTextContent('Không tải được phiên kiểm kho');expect(h.signals[0].aborted).toBe(true);await act(async()=>{finish({data:{id:'late'},error:null});});expect(screen.queryByRole('button',{name:'Chốt kiểm kho'})).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Thử tải lại phiên kiểm kho'}));await act(async()=>{});expect(screen.getByRole('button',{name:'Tạo phiên kiểm kho'})).toBeEnabled();expect(h.rpc).not.toHaveBeenCalled();
});
it('blocks menu-unavailable actions but retains unsent counted draft',async()=>{
 h.read.mockImplementation(async(table:string)=>({data:table==='fnb_stocktakes'?{id:'30000000-0000-4000-8000-000000000001'}:[{ingredient_id:'40000000-0000-4000-8000-000000000001',counted_qty:3}],error:null}));const v=render(<StocktakeBoard clubId="20000000-0000-4000-8000-000000000001"/>);const count=await screen.findByDisplayValue('3');fireEvent.change(count,{target:{value:'4'}});h.menuError=true;v.rerender(<StocktakeBoard clubId="20000000-0000-4000-8000-000000000001"/>);expect(screen.getByRole('alert')).toHaveTextContent('Không tải được thực đơn');expect(screen.queryByRole('button',{name:'Chốt kiểm kho'})).not.toBeInTheDocument();expect(h.rpc).not.toHaveBeenCalled();h.menuError=false;v.rerender(<StocktakeBoard clubId="20000000-0000-4000-8000-000000000001"/>);expect(screen.getByDisplayValue('4')).toBeInTheDocument();
});
it('re-reads the canonical session after a successful open acknowledgement',async()=>{
 let opened=false;h.read.mockImplementation(async(table:string)=>({data:table==='fnb_stocktakes'?(opened?{id:'30000000-0000-4000-8000-000000000003'}:null):[{ingredient_id:'40000000-0000-4000-8000-000000000001',counted_qty:0}],error:null}));h.rpc.mockImplementation(async()=>{opened=true;return {data:{status:'ok',stocktake_id:'30000000-0000-4000-8000-000000000003',idempotent:false},error:null};});render(<StocktakeBoard clubId="20000000-0000-4000-8000-000000000001"/>);fireEvent.click(await screen.findByRole('button',{name:'Tạo phiên kiểm kho'}));await screen.findByText('Kiểm kho · phiên đang mở');expect(screen.getByDisplayValue('0')).toBeInTheDocument();expect(h.read).toHaveBeenCalledTimes(3);expect(h.rpc).toHaveBeenCalledTimes(1);
});

it('keeps an acknowledged commit pending on changed server counts, then settles only exact READ proof',async()=>{
 openBoard();vi.mocked(toast.success).mockClear();h.rpc.mockResolvedValue({data:{status:'ok',committed:true,adjusted_lines:1},error:null});render(<StocktakeBoard clubId={recoveryOpen.clubId}/>);await screen.findByRole('button',{name:'Chốt kiểm kho'});acceptCommit();await act(async()=>{});
 const committed={...recoveryRow,status:'committed',committed_by:recoveryOpen.actorId,committed_at:'2026-10-27T02:00:00Z'};let qty='4';h.read.mockImplementation(async(table:string,f:Record<string,string>)=>table==='fnb_stocktakes'?{data:f.id?committed:null,error:null}:{data:[{stocktake_id:recoveryRow.id,club_id:recoveryOpen.clubId,ingredient_id:'40000000-0000-4000-8000-000000000001',counted_qty:qty,expected_qty:'5',delta_applied:qty==='4'?'-1':'-2'}],count:1,error:null});
 fireEvent.click(screen.getByRole('button',{name:'Đối chiếu yêu cầu kiểm kho'}));await act(async()=>{});expect(readStocktakeOperation(localStorage,recoveryOpen.actorId,recoveryOpen.clubId,recoveryOpen.backend)?.state).toBe('pending');expect(toast.success).not.toHaveBeenCalled();expect(h.rpc).toHaveBeenCalledTimes(1);
 qty='3';fireEvent.click(screen.getByRole('button',{name:'Đối chiếu yêu cầu kiểm kho'}));await act(async()=>{});expect(readStocktakeOperation(localStorage,recoveryOpen.actorId,recoveryOpen.clubId,recoveryOpen.backend)?.state).toBe('settled');expect(h.rpc).toHaveBeenCalledTimes(1);
});
