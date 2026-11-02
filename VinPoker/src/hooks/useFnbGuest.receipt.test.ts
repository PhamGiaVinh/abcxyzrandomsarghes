import {afterEach,expect,it,vi} from 'vitest';
const {rpc}=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc}}));
import {fnbGuestReadReceipt,fnbGuestAbandonIntent} from './useFnbGuest';
import {fnbGuestIntentPayload,type FnbGuestIntent} from '@/lib/fnbGuestIntent';
const intent:FnbGuestIntent={version:1,token:'LOCAL-TEST339',requestId:'10000000-0000-4000-8000-000000000002',seat:3,customerName:'TEST',note:null,lines:[{menu_item_id:'10000000-0000-4000-8000-000000000001',qty:1}],paymentMethod:'cash'};
const receipt={status:'ok',order_id:'10000000-0000-4000-8000-000000000003',idempotent:true,subtotal_vnd:10000,payment_method:'cash',reference_code:null,expires_at:'2026-10-21T12:00:00Z',bank:null};
const packet={found:true,request_id:intent.requestId,payload:fnbGuestIntentPayload(intent),receipt};
afterEach(()=>{rpc.mockReset();vi.useRealTimers();});
it('reads exact receipt without dispatching any mutation',async()=>{
 rpc.mockResolvedValue({data:packet,error:null});
 expect(await fnbGuestReadReceipt(intent)).toMatchObject({kind:'found',receipt});
 expect(rpc).toHaveBeenCalledTimes(1);
 expect(rpc).toHaveBeenCalledWith('fnb_guest_order_receipt_v1',expect.objectContaining({p_token:intent.token,p_client_request_id:intent.requestId,p_lines:intent.lines}));
});
it('distinguishes missing from malformed, conflict and transport failure',async()=>{
 rpc.mockResolvedValueOnce({data:{...packet,found:false,receipt:null},error:null});
 expect(await fnbGuestReadReceipt(intent)).toEqual({kind:'missing'});
 for(const data of [null,{error:'REQUEST_ID_CONFLICT'},{...packet,payload:{...packet.payload,seat:4}}]){
  rpc.mockResolvedValueOnce({data,error:null});expect(await fnbGuestReadReceipt(intent)).toEqual({kind:'unknown'});
 }
 rpc.mockResolvedValueOnce({data:null,error:{code:'PGRST202'}});
 expect(await fnbGuestReadReceipt(intent)).toEqual({kind:'unknown'});
 rpc.mockRejectedValueOnce(Error('TEST offline'));
 expect(await fnbGuestReadReceipt(intent)).toEqual({kind:'unknown'});
});
it('bounds a hung lookup and does not retry or create',async()=>{
 vi.useFakeTimers();rpc.mockReturnValue(new Promise(()=>{}));
 const pending=fnbGuestReadReceipt(intent);await vi.advanceTimersByTimeAsync(20000);
 expect(await pending).toEqual({kind:'unknown'});expect(rpc).toHaveBeenCalledTimes(1);
});
it('rejects invalid persisted intent before network access',async()=>{
 expect(await fnbGuestReadReceipt({...intent,requestId:'invalid'})).toEqual({kind:'unknown'});
 expect(rpc).not.toHaveBeenCalled();
});
it('explicit abandon accepts only a bound fence or the already committed order',async()=>{
 const fence={error:'REQUEST_ABANDONED',request_id:intent.requestId,idempotent:true};
 rpc.mockResolvedValueOnce({data:{...packet,receipt:fence},error:null});
 expect(await fnbGuestAbandonIntent(intent)).toEqual({kind:'abandoned',receipt:fence});
 expect(rpc).toHaveBeenCalledWith('fnb_guest_abandon_request_v1',expect.objectContaining({p_client_request_id:intent.requestId,p_lines:intent.lines}));
 rpc.mockResolvedValueOnce({data:packet,error:null});expect(await fnbGuestAbandonIntent(intent)).toMatchObject({kind:'found',receipt});
});
it('abandon unknown or unexpected missing cannot authorize clearing intent',async()=>{
 rpc.mockResolvedValueOnce({data:{...packet,found:false,receipt:null},error:null});
 expect(await fnbGuestAbandonIntent(intent)).toEqual({kind:'unknown'});
 rpc.mockRejectedValueOnce(Error('TEST offline'));expect(await fnbGuestAbandonIntent(intent)).toEqual({kind:'unknown'});
 expect(rpc).toHaveBeenCalledTimes(2);
});
