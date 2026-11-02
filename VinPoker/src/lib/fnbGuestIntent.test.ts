import {expect,it} from 'vitest';
import {saveFnbGuestIntent,parseFnbGuestIntent,fnbGuestIntentKey,fnbGuestIntentPayload,clearResolvedFnbGuestIntent,parseFnbGuestReceiptLookup,type FnbGuestIntent} from './fnbGuestIntent';
const intent:FnbGuestIntent={version:1,token:'LOCAL-TEST338',requestId:'10000000-0000-4000-8000-000000000001',seat:3,customerName:'TEST',note:null,
 lines:[{menu_item_id:'10000000-0000-4000-8000-000000000002',qty:1}],paymentMethod:'cash'};
const receipt={status:'ok',order_id:'10000000-0000-4000-8000-000000000003',idempotent:true,subtotal_vnd:10000,payment_method:'cash',reference_code:null,bank:null,expires_at:'2026-10-21T12:00:00Z'};
const storage=()=>{const m=new Map<string,string>();return {getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>{m.set(k,v);},removeItem:(k:string)=>{m.delete(k);}};};
it('persists exact intent and refuses another key or changed payload while pending',()=>{
 const s=storage();saveFnbGuestIntent(s,intent);saveFnbGuestIntent(s,intent);
 expect(parseFnbGuestIntent(s.getItem(fnbGuestIntentKey(intent.token))!,intent.token)).toEqual(intent);
 expect(()=>saveFnbGuestIntent(s,{...intent,seat:4})).toThrow('FNB_GUEST_JOURNAL_CONFLICT');
 expect(()=>saveFnbGuestIntent(s,{...intent,requestId:receipt.order_id})).toThrow('FNB_GUEST_JOURNAL_CONFLICT');
 expect(()=>clearResolvedFnbGuestIntent(s,intent.token)).toThrow('FNB_GUEST_ORDER_UNKNOWN');
});
it('requires confirmed receipt before resolving and explicit clear before starting another order',()=>{
 const s=storage();saveFnbGuestIntent(s,intent);
 expect(()=>saveFnbGuestIntent(s,{...intent,resolved:true})).toThrow();
 saveFnbGuestIntent(s,{...intent,resolved:true,receipt});
 expect(()=>saveFnbGuestIntent(s,intent)).toThrow();
 clearResolvedFnbGuestIntent(s,intent.token);expect(s.getItem(fnbGuestIntentKey(intent.token))).toBeNull();
});
it('does not ignore storage failure, corrupt journal or foreign table scope',()=>{
 expect(()=>saveFnbGuestIntent({getItem:()=>null,setItem:()=>{}},intent)).toThrow('FNB_GUEST_JOURNAL_WRITE_FAILED');
 expect(()=>parseFnbGuestIntent('{',intent.token)).toThrow();
 expect(()=>parseFnbGuestIntent(JSON.stringify(intent),'OTHER-TEST')).toThrow('FNB_GUEST_JOURNAL_SCOPE');
});
it('distinguishes found/missing/unknown read without authorizing a new order',()=>{
 const packet={found:true,request_id:intent.requestId,payload:fnbGuestIntentPayload(intent),receipt};
 expect(parseFnbGuestReceiptLookup(packet,intent)).toMatchObject({kind:'found',receipt});
 expect(parseFnbGuestReceiptLookup({...packet,found:false,receipt:null},intent)).toEqual({kind:'missing'});
 for(const bad of [{...packet,request_id:receipt.order_id},{...packet,payload:{...packet.payload,seat:4}},{...packet,receipt:{}},{error:'REQUEST_ID_CONFLICT'}])expect(parseFnbGuestReceiptLookup(bad,intent)).toEqual({kind:'unknown'});
});
it('accepts JSONB key ordering without accepting changed lines or extra fields',()=>{
 const payload={...fnbGuestIntentPayload(intent),lines:[{qty:1,menu_item_id:intent.lines[0].menu_item_id}]};
 const packet={found:true,request_id:intent.requestId,payload,receipt};
 expect(parseFnbGuestReceiptLookup(packet,intent)).toMatchObject({kind:'found'});
 expect(parseFnbGuestReceiptLookup({...packet,payload:{...payload,lines:[{qty:2,menu_item_id:intent.lines[0].menu_item_id}]}},intent)).toEqual({kind:'unknown'});
 expect(parseFnbGuestReceiptLookup({...packet,payload:{...payload,lines:[{...payload.lines[0],extra:true}]}},intent)).toEqual({kind:'unknown'});
});
it('accepts an exact server abandonment fence and permits clear only after durable resolution',()=>{
 const fence={error:'REQUEST_ABANDONED',request_id:intent.requestId,idempotent:true};
 const packet={found:true,request_id:intent.requestId,payload:fnbGuestIntentPayload(intent),receipt:fence};
 expect(parseFnbGuestReceiptLookup(packet,intent)).toEqual({kind:'abandoned',receipt:fence});
 const s=storage();saveFnbGuestIntent(s,intent);saveFnbGuestIntent(s,{...intent,resolved:true,receipt:fence});
 clearResolvedFnbGuestIntent(s,intent.token);expect(s.getItem(fnbGuestIntentKey(intent.token))).toBeNull();
 for(const bad of [{...fence,request_id:receipt.order_id},{...fence,idempotent:false},{...fence,order_id:receipt.order_id}]){
  expect(parseFnbGuestReceiptLookup({...packet,receipt:bad},intent)).toEqual({kind:'unknown'});
  expect(()=>parseFnbGuestIntent(JSON.stringify({...intent,resolved:true,receipt:bad}),intent.token)).toThrow();
 }
});
