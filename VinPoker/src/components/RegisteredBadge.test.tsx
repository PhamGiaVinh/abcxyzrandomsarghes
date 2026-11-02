import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({auth:{user:{id:'actor-a'} as {id:string}|null,loading:false,authError:null},from:vi.fn(),receipt:vi.fn()}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>h.auth}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:(table:string)=>h.from(table)}}));
vi.mock('@/components/tournament/seat/buyinReceipt',()=>({fetchBuyinReceipt:(args:unknown)=>h.receipt(args),toSeatReceiptData:(v:unknown)=>v}));
vi.mock('@/components/tournament/seat/SeatReceiptDialog',()=>({SeatReceiptDialog:()=>null}));
import {RegisteredBadge} from './RegisteredBadge';
const registration={id:'reg-a',status:'pending',tournament_id:'tour-a'};
function queryFor(table:string,result:(actor:string)=>Promise<unknown>){
 let actor='';const q:Record<string,unknown>={};
 for(const method of ['select','in','order','limit','abortSignal'])q[method]=()=>q;
 q.eq=(key:string,value:string)=>{if(key==='player_id')actor=value;return q;};
 q.then=(resolve:(v:unknown)=>unknown,reject:(e:unknown)=>unknown)=>result(actor).then(resolve,reject);
 return q;
}
beforeEach(()=>{vi.clearAllMocks();h.auth={user:{id:'actor-a'},loading:false,authError:null};h.receipt.mockResolvedValue(null);
 h.from.mockImplementation((table:string)=>queryFor(table,async()=>({data:table==='tournament_registrations'?[registration]:[{id:'tour-a',name:'PRIVATE A TOUR',status:'active'}],error:null})));
});
afterEach(()=>{cleanup();vi.useRealTimers();});
it('keeps the DM inline registration error and verified receipt control out of the floating layer',async()=>{
 h.from.mockImplementation((table:string)=>queryFor(table,async()=>({data:null,error:{code:'503'}})));
 const view=render(<RegisteredBadge placement="inline"/>);
 expect(await screen.findByRole('alert')).not.toHaveClass('fixed');
 h.from.mockImplementation((table:string)=>queryFor(table,async()=>({data:table==='tournament_registrations'?[registration]:[{id:'tour-a',name:'PRIVATE A TOUR',status:'active'}],error:null})));
 fireEvent.click(screen.getByRole('button',{name:'Thử tải lại đăng ký'}));
 expect(await screen.findByRole('button',{name:'Xem phiếu đăng ký'})).not.toHaveClass('fixed');
 view.rerender(<RegisteredBadge/>);
 expect(screen.getByRole('button',{name:'Xem phiếu đăng ký'})).toHaveClass('fixed');
});
it('never shows an old actor registration when its read finishes after switching accounts',async()=>{
 let finish!:(v:unknown)=>void;
 h.from.mockImplementation((table:string)=>queryFor(table,actor=>table==='tournament_registrations'
  ?actor==='actor-a'?new Promise(resolve=>{finish=resolve;}):Promise.resolve({data:[],error:null})
  :Promise.resolve({data:[{id:'tour-a',name:'PRIVATE A TOUR',status:'active'}],error:null})));
 const view=render(<RegisteredBadge/>);await waitFor(()=>expect(finish).toBeTypeOf('function'));
 h.auth.user={id:'actor-b'};view.rerender(<RegisteredBadge/>);await act(async()=>{});
 await act(async()=>finish({data:[registration],error:null}));
 expect(screen.queryByRole('button',{name:'Xem phiếu đăng ký'})).not.toBeInTheDocument();
});
it('does not infer an active registration when tournament metadata failed',async()=>{
 h.from.mockImplementation((table:string)=>queryFor(table,async()=>table==='tournaments'?{data:null,error:{code:'503'}}:{data:[registration],error:null}));
 render(<RegisteredBadge/>);expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được');
 expect(screen.queryByRole('button',{name:'Xem phiếu đăng ký'})).not.toBeInTheDocument();
});
it('shows receipt lookup failure as unverified, not as waiting for payment',async()=>{
 render(<RegisteredBadge/>);fireEvent.click(await screen.findByRole('button',{name:'Xem phiếu đăng ký'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Chưa xác minh được phiếu');
 expect(screen.queryByText(/Đang chờ xác nhận chuyển khoản/)).not.toBeInTheDocument();
});
it('recovers failed metadata through an explicit read retry',async()=>{
 let failing=true;
 h.from.mockImplementation((table:string)=>queryFor(table,async()=>table==='tournaments'&&failing
  ?{data:null,error:{code:'503'}}:{data:table==='tournament_registrations'?[registration]:[{id:'tour-a',name:'PRIVATE A TOUR',status:'active'}],error:null}));
 render(<RegisteredBadge/>);await screen.findByRole('alert');failing=false;
 fireEvent.click(screen.getByRole('button',{name:'Thử tải lại đăng ký'}));
 expect(await screen.findByRole('button',{name:'Xem phiếu đăng ký'})).toBeInTheDocument();expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('recovers an unavailable receipt without inferring a payment until the read succeeds',async()=>{
 h.receipt.mockResolvedValueOnce(null).mockResolvedValueOnce({status:'pending',receipt_code:null});
 render(<RegisteredBadge/>);fireEvent.click(await screen.findByRole('button',{name:'Xem phiếu đăng ký'}));await screen.findByRole('alert');
 fireEvent.click(screen.getByRole('button',{name:'Thử tải lại phiếu'}));
 expect(await screen.findByText(/Đang chờ xác nhận chuyển khoản/)).toBeInTheDocument();
 expect(h.receipt).toHaveBeenCalledTimes(2);expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it.each(['logout','loading'])('hides the previous account registration immediately on %s',async(change)=>{
 const view=render(<RegisteredBadge/>);await screen.findByRole('button',{name:'Xem phiếu đăng ký'});
 if(change==='logout')h.auth.user=null;else h.auth.loading=true;
 view.rerender(<RegisteredBadge/>);expect(screen.queryByRole('button',{name:'Xem phiếu đăng ký'})).not.toBeInTheDocument();
});
it('bounds a hung registration read and aborts the SDK transport',async()=>{
 vi.useFakeTimers();const signals:AbortSignal[]=[];
 h.from.mockImplementation((table:string)=>{const q=queryFor(table,()=>new Promise(()=>{}));q.abortSignal=(signal:AbortSignal)=>{signals.push(signal);return q;};return q;});
 render(<RegisteredBadge/>);await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});
 expect(screen.getByRole('alert')).toHaveTextContent('Không tải được');expect(signals).toHaveLength(1);expect(signals[0].aborted).toBe(true);
});
