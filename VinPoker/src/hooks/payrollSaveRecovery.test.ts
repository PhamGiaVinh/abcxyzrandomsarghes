import {beforeEach,expect,it,vi} from 'vitest';
const {rpc}=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc}}));
import {savePayrollWithIntent,getPayrollSaveReceipt,cancelUnresolvedPayrollSave} from './useDealerPayroll';
const intent={version:1 as const,actorId:'11111111-1111-4111-8111-111111111111',clubId:'22222222-2222-4222-8222-222222222222',year:2026,month:10,requestId:'33333333-3333-4333-8333-333333333333'};
const saved={ok:true,outcome:'saved',requestId:intent.requestId,clubId:intent.clubId,year:2026,month:10,periodId:'44444444-4444-4444-8444-444444444444',savedCount:0};
beforeEach(()=>{rpc.mockReset();});
it.each(['save','cancel'])('leaves a hung %s outcome unknown without sending another request',async(kind)=>{
 vi.useFakeTimers();let resolve!:(value:unknown)=>void;let failure:unknown;
 rpc.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
 const pending=(kind==='save'?savePayrollWithIntent(intent,[]):cancelUnresolvedPayrollSave(intent)).catch(error=>{failure=error;});
 try{
   await vi.advanceTimersByTimeAsync(20001);expect((failure as Error).message).toBe('PAYROLL_SAVE_OUTCOME_UNKNOWN');expect(rpc).toHaveBeenCalledTimes(1);
 }finally{resolve({data:saved,error:null});await pending;vi.useRealTimers();}
});
it('writes exactly once through v2 with the durable request',async()=>{
 rpc.mockResolvedValue({data:saved,error:null});expect(await savePayrollWithIntent(intent,[])).toEqual(saved);
 expect(rpc).toHaveBeenCalledTimes(1);expect(rpc).toHaveBeenCalledWith('save_payroll_period_v2',expect.objectContaining({p_request_id:intent.requestId,p_club_id:intent.clubId,p_start_date:'2026-10-01',p_end_date:'2026-10-31'}));
});
it('treats absent receipt as unresolved and performs no write',async()=>{
 rpc.mockResolvedValue({data:null,error:null});expect(await getPayrollSaveReceipt(intent)).toBeNull();
 expect(rpc).toHaveBeenCalledTimes(1);expect(rpc.mock.calls[0][0]).toBe('get_payroll_save_receipt_v2');
});
it('rejects a receipt from a different scope',async()=>{
 rpc.mockResolvedValue({data:{...saved,month:9},error:null});await expect(getPayrollSaveReceipt(intent)).rejects.toThrow('PAYROLL_RECEIPT_SCOPE_INVALID');
});
it('keeps unknown write outcomes without falling back to v1',async()=>{
 rpc.mockRejectedValue(new Error('LOCAL response lost'));await expect(savePayrollWithIntent(intent,[])).rejects.toThrow('LOCAL response lost');expect(rpc).toHaveBeenCalledTimes(1);
});
it('cancellation can return a committed save instead of undoing it',async()=>{
 rpc.mockResolvedValue({data:saved,error:null});expect(await cancelUnresolvedPayrollSave(intent)).toEqual(saved);
 expect(rpc).toHaveBeenCalledWith('cancel_unresolved_payroll_save_v2',expect.objectContaining({p_request_id:intent.requestId,p_year:2026,p_month:10}));
});
