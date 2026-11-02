import {afterEach,expect,it,vi} from 'vitest';
const {rpc}=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc}}));
import {fnbGuestCreateOrder} from './useFnbGuest';
const args={token:'LOCAL-TEST337',seat:3,customerName:'TEST',note:null,lines:[{menu_item_id:'10000000-0000-4000-8000-000000000001',qty:1}],paymentMethod:'cash' as const,clientRequestId:'10000000-0000-4000-8000-000000000002'};
const valid={status:'ok',order_id:'10000000-0000-4000-8000-000000000003',idempotent:false,subtotal_vnd:10000,payment_method:'cash',reference_code:null,expires_at:'2026-10-21T12:00:00Z',bank:null};
afterEach(()=>{rpc.mockReset();vi.useRealTimers();});
it.each([null,{}, {status:'ok'}, {...valid,subtotal_vnd:null},{...valid,subtotal_vnd:1.5},{...valid,subtotal_vnd:Number.MAX_SAFE_INTEGER+1},{...valid,payment_method:'bank_transfer'}])('does not accept malformed guest create receipt %j',async(data)=>{
 rpc.mockResolvedValue({data,error:null});
 expect(await fnbGuestCreateOrder(args)).toEqual({res:null,errorCode:'FNB_MUTATION_UNKNOWN'});
});
it('bounds a rejected transport without claiming rejection or success',async()=>{
 rpc.mockRejectedValue(new Error('TEST offline'));
 expect(await fnbGuestCreateOrder(args)).toEqual({res:null,errorCode:'FNB_MUTATION_UNKNOWN'});
});
it('ends a hung create as unknown without dispatching another request',async()=>{
 vi.useFakeTimers();rpc.mockReturnValue(new Promise(()=>{}));
 const pending=fnbGuestCreateOrder(args);
 await vi.advanceTimersByTimeAsync(20000);
 expect(await pending).toEqual({res:null,errorCode:'FNB_MUTATION_UNKNOWN'});
 expect(rpc).toHaveBeenCalledTimes(1);
});
it('accepts actual cash contract and preserves business conflict',async()=>{
 rpc.mockResolvedValueOnce({data:valid,error:null}).mockResolvedValueOnce({data:{error:'REQUEST_ID_CONFLICT'},error:null});
 expect((await fnbGuestCreateOrder(args)).res).toMatchObject({order_id:valid.order_id,subtotal_vnd:10000});
 expect(await fnbGuestCreateOrder(args)).toEqual({res:null,errorCode:'REQUEST_ID_CONFLICT'});
});
