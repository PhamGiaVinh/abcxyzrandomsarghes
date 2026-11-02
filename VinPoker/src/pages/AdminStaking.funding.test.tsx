import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({invoke:vi.fn(),success:vi.fn(),error:vi.fn(),session:{access_token:'LOCAL_A'},failTable:'',purchaseReads:[] as Promise<unknown>[],signals:[] as AbortSignal[]}));
const actor='e5490000-0000-4000-8000-000000000001',purchase='e5490000-0000-4000-8000-000000000002',deal='e5490000-0000-4000-8000-000000000003';
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({isAdmin:true,user:{id:actor},session:h.session})}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
vi.mock('sonner',()=>({toast:{success:h.success,error:h.error}}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:h.invoke},from:(table:string)=>{
 const data=table==='staking_purchases'?[{id:purchase,deal_id:deal,backer_id:actor,percent:10,amount_vnd:100000,status:'committed',reference_code:'LOCAL549',committed_at:new Date().toISOString()}]:
  table==='staking_deals'?[{id:deal,club_id:null,player_id:actor,percentage_sold:10,filled_percent:10,early_closed:false,status:'committed',custom_event_name:'LOCAL549 TEST',tournament_id:null}]:
   table==='profiles'?[{user_id:actor,display_name:'LOCAL549'}]:[];
 const q={select:()=>q,eq:()=>q,in:()=>q,order:()=>q,abortSignal:(signal:AbortSignal)=>{h.signals.push(signal);return q;},then:(resolve:(v:unknown)=>unknown)=>(table==='staking_purchases'&&h.purchaseReads.length?h.purchaseReads.shift()!:Promise.resolve(h.failTable===table?{data:null,error:{message:'LOCAL503'}}:{data,error:null})).then(resolve)};return q;
 },channel:()=>{const c={on:()=>c,subscribe:()=>c};return c;},removeChannel:vi.fn()}}));
import {PendingTab} from './AdminStaking';
const canonical={success:true,purchase_id:purchase,purchase_status:'funded',deal_status:'funded',total_funded_percent:10,total_committed_percent:0};
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();h.session={access_token:'LOCAL_A'};h.failTable='';h.purchaseReads=[];h.signals=[];});
async function open(){render(<PendingTab cashierOnlyUserId={null}/>);fireEvent.click(await screen.findByRole('button',{name:'stakingAdmin.pending.confirm'}));return screen.getByRole('button',{name:'stakingAdmin.pending.confirmFunded'});}
it('persists the exact Admin purchase intent before money confirmation',async()=>{
 h.invoke.mockImplementation(()=>{expect(localStorage.getItem(`vinpoker:staking-funding:v1:${actor}:${purchase}`)).toContain(purchase);return {data:canonical,error:null};});
 fireEvent.click(await open());await waitFor(()=>expect(h.success).toHaveBeenCalledOnce());
});
it('shows read-only recovery after remount even if pending purchases are empty',async()=>{
 localStorage.setItem(`vinpoker:staking-funding:v1:${actor}:${purchase}`,JSON.stringify({actor_id:actor,purchase_id:purchase,club_id:null,reference:'LOCAL549'}));
 h.purchaseReads=[Promise.resolve({data:[],error:null})];render(<PendingTab cashierOnlyUserId={null}/>);
 expect(await screen.findByRole('button',{name:'Tra kết quả FUNDED LOCAL549'})).toBeEnabled();expect(h.invoke).not.toHaveBeenCalled();
});
it('recovers Admin receipt and held-email status without calling the writer',async()=>{
 localStorage.setItem(`vinpoker:staking-funding:v1:${actor}:${purchase}`,JSON.stringify({actor_id:actor,purchase_id:purchase,club_id:null,reference:'LOCAL549'}));
 h.invoke.mockResolvedValue({data:{...canonical,delivery:{purchase_id:purchase,expected:2,total:2,delivered:1,pending:0,processing:0,needs_attention:1,evidence_missing:false,state:'needs_attention'}},error:null});
 render(<PendingTab cashierOnlyUserId={null}/>);fireEvent.click(await screen.findByRole('button',{name:'Tra kết quả FUNDED LOCAL549'}));
 expect(await screen.findByRole('status')).toHaveTextContent('email cần đối chiếu');expect(h.invoke).toHaveBeenCalledExactlyOnceWith('admin-staking-funding-status',expect.objectContaining({body:{purchase_id:purchase}}));expect(localStorage.length).toBe(1);
});
it('submits one funding request for a same-tick double click',async()=>{
 const release:Array<(v:unknown)=>void>=[];h.invoke.mockImplementation(()=>new Promise(r=>release.push(r)));const button=await open();
 act(()=>{fireEvent.click(button);fireEvent.click(button);});const calls=h.invoke.mock.calls.length;
 await act(async()=>{for(const resolve of release)resolve({data:canonical,error:null});});expect(calls).toBe(1);
});
it.each([null,{}, {ok:true},{...canonical,purchase_id:deal}])('never reports funding from unverified packet %j',async data=>{
 h.invoke.mockResolvedValue({data,error:null});const button=await open();fireEvent.click(button);
 await waitFor(()=>expect(h.error).toHaveBeenCalled());expect(h.success).not.toHaveBeenCalled();
});
it('invalidates an old confirmation when the authenticated session changes',async()=>{
 const view=render(<PendingTab cashierOnlyUserId={null}/>);fireEvent.click(await screen.findByRole('button',{name:'stakingAdmin.pending.confirm'}));
 h.session={access_token:'LOCAL_B'};view.rerender(<PendingTab cashierOnlyUserId={null}/>);
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(h.invoke).not.toHaveBeenCalled();
});
it('restores controls after an unknown transport outcome without automatic retry',async()=>{
 h.invoke.mockRejectedValue(new Error('offline'));const button=await open();fireEvent.click(button);
 await waitFor(()=>expect(h.error).toHaveBeenCalled());expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'stakingAdmin.pending.confirm'})).toBeDisabled();
 expect(screen.getByRole('button',{name:'Tra kết quả FUNDED LOCAL549'})).toBeEnabled();expect(h.invoke).toHaveBeenCalledTimes(1);expect(h.success).not.toHaveBeenCalled();
});
it.each(['not_recorded','needs_attention'])('uses %s only as a read observation, not automatic funding',async state=>{
 localStorage.setItem(`vinpoker:staking-funding:v1:${actor}:${purchase}`,JSON.stringify({actor_id:actor,purchase_id:purchase,club_id:null,reference:'LOCAL549'}));
 h.invoke.mockResolvedValue({data:{success:false,purchase_id:purchase,state},error:null});render(<PendingTab cashierOnlyUserId={null}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Tra kết quả FUNDED LOCAL549'}));expect(await screen.findByRole('status')).toHaveTextContent(state==='not_recorded'?'Chưa tìm thấy':'cần đối chiếu');
 expect(h.invoke).toHaveBeenCalledTimes(1);expect(localStorage.length).toBe(1);expect(h.success).not.toHaveBeenCalled();
 expect(screen.getByRole('button',{name:'stakingAdmin.pending.confirm'})).toHaveProperty('disabled',state!=='not_recorded');
});
it('does not clear corrupt recovery evidence or enable money submission',async()=>{
 localStorage.setItem(`vinpoker:staking-funding:v1:${actor}:${purchase}`,'CORRUPT');render(<PendingTab cashierOnlyUserId={null}/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('Giữ nguyên');expect(await screen.findByRole('button',{name:'stakingAdmin.pending.confirm'})).toBeDisabled();expect(h.invoke).not.toHaveBeenCalled();expect(localStorage.length).toBe(1);
});
it('blocks money submission when intent cannot be persisted',async()=>{
 const spy=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('LOCAL quota');});
 try{fireEvent.click(await open());await waitFor(()=>expect(h.error).toHaveBeenCalled());expect(h.invoke).not.toHaveBeenCalled();expect(h.success).not.toHaveBeenCalled();}finally{spy.mockRestore();}
});
it('keeps the recovery intent when an old-session read arrives late',async()=>{
 localStorage.setItem(`vinpoker:staking-funding:v1:${actor}:${purchase}`,JSON.stringify({actor_id:actor,purchase_id:purchase,club_id:null,reference:'LOCAL549'}));
 let resolve!:(v:unknown)=>void;h.invoke.mockImplementation(()=>new Promise(r=>{resolve=r;}));const view=render(<PendingTab cashierOnlyUserId={null}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Tra kết quả FUNDED LOCAL549'}));const signal=h.invoke.mock.calls[0][1].signal;
 h.session={access_token:'LOCAL_B'};view.rerender(<PendingTab cashierOnlyUserId={null}/>);expect(signal.aborted).toBe(true);
 await act(async()=>resolve({data:canonical,error:null}));expect(screen.queryByRole('status')).not.toBeInTheDocument();expect(localStorage.length).toBe(1);
});
it('ignores a late successful response from the prior authenticated session',async()=>{
 let resolve!:(v:unknown)=>void;h.invoke.mockImplementation(()=>new Promise(r=>{resolve=r;}));
 const view=render(<PendingTab cashierOnlyUserId={null}/>);fireEvent.click(await screen.findByRole('button',{name:'stakingAdmin.pending.confirm'}));
 fireEvent.click(screen.getByRole('button',{name:'stakingAdmin.pending.confirmFunded'}));
 h.session={access_token:'LOCAL_B'};view.rerender(<PendingTab cashierOnlyUserId={null}/>);
 await act(async()=>resolve({data:canonical,error:null}));expect(h.success).not.toHaveBeenCalled();expect(h.error).not.toHaveBeenCalled();expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('accepts a canonical receipt once and closes the confirmation',async()=>{
 h.invoke.mockResolvedValue({data:canonical,error:null});fireEvent.click(await open());
 await waitFor(()=>expect(h.success).toHaveBeenCalledTimes(1));expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(h.invoke).toHaveBeenCalledTimes(1);
});
it.each(['pending','needs_attention','unavailable'])('keeps money confirmation distinct from %s email delivery',async state=>{
 const delivery=state==='unavailable'?{state}:{purchase_id:purchase,expected:2,total:2,delivered:0,pending:state==='pending'?2:0,processing:0,needs_attention:state==='needs_attention'?2:0,evidence_missing:false,state};
 h.invoke.mockResolvedValue({data:{...canonical,delivery},error:null});fireEvent.click(await open());
 await waitFor(()=>expect(h.success).toHaveBeenCalledOnce());
 expect(await screen.findByRole('status')).toHaveTextContent('Đã xác nhận FUNDED');
 expect(screen.getByRole('status')).toHaveTextContent('email');expect(h.invoke).toHaveBeenCalledTimes(1);
});
it('does not carry the funding outcome banner into another session',async()=>{
 h.invoke.mockResolvedValue({data:canonical,error:null});const view=render(<PendingTab cashierOnlyUserId={null}/>);
 fireEvent.click(await screen.findByRole('button',{name:'stakingAdmin.pending.confirm'}));fireEvent.click(screen.getByRole('button',{name:'stakingAdmin.pending.confirmFunded'}));
 expect(await screen.findByRole('status')).toHaveTextContent('Đã xác nhận FUNDED');
 h.session={access_token:'LOCAL_B'};view.rerender(<PendingTab cashierOnlyUserId={null}/>);expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
it.each(['staking_purchases','staking_deals','profiles'])('shows a read error rather than an empty or actionable list when %s fails',async table=>{
 h.failTable=table;render(<PendingTab cashierOnlyUserId={null}/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được');
 expect(screen.queryByText('stakingAdmin.pending.empty')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'stakingAdmin.pending.confirm'})).not.toBeInTheDocument();
});
it('aborts an earlier refresh and ignores its late empty result',async()=>{
 let resolve!:(v:unknown)=>void;h.purchaseReads=[new Promise(r=>{resolve=r;})];render(<PendingTab cashierOnlyUserId={null}/>);
 await waitFor(()=>expect(h.signals).toHaveLength(1));const first=h.signals[0];
 fireEvent.click(screen.getByRole('button',{name:'stakingAdmin.refresh'}));
 expect(await screen.findByRole('button',{name:'stakingAdmin.pending.confirm'})).toBeEnabled();expect(first.aborted).toBe(true);
 await act(async()=>resolve({data:[],error:null}));expect(screen.getByRole('button',{name:'stakingAdmin.pending.confirm'})).toBeEnabled();expect(screen.queryByText('stakingAdmin.pending.empty')).not.toBeInTheDocument();
});
it('ends a hung read with an explicit error and aborts the request',async()=>{
 vi.useFakeTimers();try{
 h.purchaseReads=[new Promise(()=>{})];render(<PendingTab cashierOnlyUserId={null}/>);
 await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});expect(screen.getByRole('alert')).toHaveTextContent('Không tải được');expect(h.signals[0].aborted).toBe(true);
 }finally{vi.useRealTimers();}
});
