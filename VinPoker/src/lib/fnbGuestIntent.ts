import {z} from 'zod';
import {fnbGuestCreateOutcome} from './fnbMutationOutcome';
import type {FnbGuestCreateResult} from '@/hooks/useFnbGuest';
export const FNB_GUEST_MAX_QTY=20;
export const FNB_GUEST_MAX_LINES=30;
const abandonReceiptSchema=z.object({error:z.literal('REQUEST_ABANDONED'),request_id:z.string().uuid(),idempotent:z.literal(true)}).strict();
export type FnbGuestAbandonReceipt=z.infer<typeof abandonReceiptSchema>;
export function isFnbGuestAbandonReceipt(value:unknown,requestId:string):value is FnbGuestAbandonReceipt{
 const parsed=abandonReceiptSchema.safeParse(value);return parsed.success&&parsed.data.request_id===requestId;
}

const intentSchema=z.object({version:z.literal(1),token:z.string().min(1),requestId:z.string().uuid(),
 seat:z.number().int().min(1).max(20).nullable(),customerName:z.string().max(60).nullable(),note:z.string().max(200).nullable(),
 lines:z.array(z.object({menu_item_id:z.string().uuid(),qty:z.number().int().min(1).max(FNB_GUEST_MAX_QTY)}).strict()).min(1).max(FNB_GUEST_MAX_LINES),
 paymentMethod:z.enum(['cash','bank_transfer']),resolved:z.boolean().optional(),receipt:z.unknown().optional(),
}).strict();
const payloadSchema=z.object({seat:intentSchema.shape.seat,customer_name:intentSchema.shape.customerName,
 note:intentSchema.shape.note,lines:intentSchema.shape.lines,payment_method:intentSchema.shape.paymentMethod}).strict();
export type FnbGuestIntent=z.infer<typeof intentSchema>;
export const fnbGuestIntentKey=(token:string)=>`fnb.guest.intent.v1.${token}`;
export function fnbGuestIntentPayload(i:FnbGuestIntent){
 return {seat:i.seat,customer_name:i.customerName?.trim()||null,note:i.note?.trim()||null,lines:i.lines,payment_method:i.paymentMethod};
}
export function parseFnbGuestIntent(raw:string,token:string):FnbGuestIntent{
 const i=intentSchema.parse(JSON.parse(raw));
 if(i.token!==token)throw Error('FNB_GUEST_JOURNAL_SCOPE');
 if(i.resolved===true){
  if(!isFnbGuestAbandonReceipt(i.receipt,i.requestId)&&fnbGuestCreateOutcome(i.receipt,i.paymentMethod).kind!=='confirmed')throw Error('FNB_GUEST_JOURNAL_RECEIPT');
 }else if(i.receipt!==undefined)throw Error('FNB_GUEST_JOURNAL_RECEIPT');
 return i;
}
export function saveFnbGuestIntent(storage:Pick<Storage,'getItem'|'setItem'>,intent:FnbGuestIntent){
 const serialized=JSON.stringify(intent),i=parseFnbGuestIntent(serialized,intent.token),key=fnbGuestIntentKey(i.token);
 const raw=storage.getItem(key);
 if(raw!==null){
  const old=parseFnbGuestIntent(raw,i.token);
  const same=old.requestId===i.requestId&&JSON.stringify(fnbGuestIntentPayload(old))===JSON.stringify(fnbGuestIntentPayload(i));
  if(!same||old.resolved===true&&i.resolved!==true
   ||old.resolved===true&&JSON.stringify(old.receipt)!==JSON.stringify(i.receipt))throw Error('FNB_GUEST_JOURNAL_CONFLICT');
 }
 storage.setItem(key,serialized);
 if(storage.getItem(key)!==serialized)throw Error('FNB_GUEST_JOURNAL_WRITE_FAILED');
}
export function clearResolvedFnbGuestIntent(storage:Pick<Storage,'getItem'|'removeItem'>,token:string){
 const key=fnbGuestIntentKey(token),raw=storage.getItem(key);
 if(raw===null)return;
 if(parseFnbGuestIntent(raw,token).resolved!==true)throw Error('FNB_GUEST_ORDER_UNKNOWN');
 storage.removeItem(key);
 if(storage.getItem(key)!==null)throw Error('FNB_GUEST_JOURNAL_CLEAR_FAILED');
}
export function fnbGuestIntentRpcArgs(i:FnbGuestIntent){
 parseFnbGuestIntent(JSON.stringify(i),i.token);
 return {p_token:i.token,p_seat:i.seat,p_customer_name:i.customerName,p_note:i.note,p_lines:i.lines,
  p_payment_method:i.paymentMethod,p_client_request_id:i.requestId};
}
export function parseFnbGuestReceiptLookup(data:unknown,i:FnbGuestIntent):{kind:'missing'}|{kind:'found';receipt:FnbGuestCreateResult}|{kind:'abandoned';receipt:FnbGuestAbandonReceipt}|{kind:'unknown'}{
 if(!data||typeof data!=='object'||Array.isArray(data))return {kind:'unknown'};
 const r=data as Record<string,unknown>;
 const payload=fnbGuestIntentPayload(i);
 if(r.error!=null||r.request_id!==i.requestId||!r.payload||typeof r.payload!=='object'||Array.isArray(r.payload))return {kind:'unknown'};
 const actual=payloadSchema.safeParse(r.payload);
 if(!actual.success||JSON.stringify(actual.data)!==JSON.stringify(payload))return {kind:'unknown'};
 if(r.found===false&&r.receipt===null)return {kind:'missing'};
 if(r.found!==true)return {kind:'unknown'};
 if(isFnbGuestAbandonReceipt(r.receipt,i.requestId))return {kind:'abandoned',receipt:abandonReceiptSchema.parse(r.receipt)};
 const parsed=fnbGuestCreateOutcome(r.receipt,i.paymentMethod);
 return parsed.kind==='confirmed'?{kind:'found',receipt:parsed.result}:{kind:'unknown'};
}
