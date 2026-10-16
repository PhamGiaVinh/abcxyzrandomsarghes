import {afterEach,expect,it,vi} from 'vitest';
import {cashPaymentJournalKey,readCashPaymentJournal,persistCashPaymentIntent,settleCashPaymentIntent,validateCashPaymentOutcome,resolveCashPaymentIntent,type CashPaymentIntent} from './cashPaymentIntent';
const intent:CashPaymentIntent={actor_id:'e1120000-0000-4000-8000-000000000001',club_id:'e1120000-0000-4000-8000-000000000002',tournament_id:'e1120000-0000-4000-8000-000000000003',registration_id:'e1120000-0000-4000-8000-000000000004',amount:10000,request_id:'e1120000-0000-4000-8000-000000000005'};
afterEach(()=>{localStorage.clear();vi.useRealTimers();});
it('retains exact pending intent and prevents overwrite or stale settlement',()=>{
 persistCashPaymentIntent(localStorage,intent);
 expect(readCashPaymentJournal(localStorage,intent.actor_id,intent.club_id)?.intent).toEqual(intent);
 expect(()=>persistCashPaymentIntent(localStorage,{...intent,request_id:crypto.randomUUID()})).toThrow('UNRESOLVED');
 expect(()=>settleCashPaymentIntent(localStorage,{...intent,amount:11000})).toThrow('CHANGED');
 settleCashPaymentIntent(localStorage,intent);
 const next={...intent,request_id:crypto.randomUUID()};persistCashPaymentIntent(localStorage,next);
 expect(()=>settleCashPaymentIntent(localStorage,intent)).toThrow('CHANGED');
});
it('blocks corrupt journal and silent storage failures',()=>{
 const key=cashPaymentJournalKey(intent.actor_id,intent.club_id);localStorage.setItem(key,'{');
 expect(()=>persistCashPaymentIntent(localStorage,intent)).toThrow();localStorage.clear();
 expect(()=>persistCashPaymentIntent({getItem:()=>null,setItem:()=>{}},intent)).toThrow('WRITE_FAILED');
});
it.each(['actor_id','club_id','tournament_id','registration_id','amount','request_id'] as const)('rejects a mismatched receipt %s',field=>{
 expect(validateCashPaymentOutcome(intent,{ok:true,status:'recorded',intent:{...intent,[field]:field==='amount'?11000:crypto.randomUUID()},result:{ok:true}})).toEqual({status:'unknown'});
});
it('distinguishes terminal rejection/cancellation from recorded cash',()=>{
 expect(validateCashPaymentOutcome(intent,{ok:true,status:'rejected',intent,result:{ok:false,error:'amount_exceeds_remaining'}}).status).toBe('rejected');
 expect(validateCashPaymentOutcome(intent,{ok:true,status:'cancelled',intent,result:{ok:false,error:'cash_intent_cancelled'}}).status).toBe('cancelled');
 expect(validateCashPaymentOutcome(intent,{ok:true,status:'recorded',intent,result:{ok:false,error:'denied'}}).status).toBe('unknown');
});
it('bounds a hung request without retrying or changing the key',async()=>{
 vi.useFakeTimers();const rpc=vi.fn().mockReturnValue(new Promise(()=>{}));const pending=resolveCashPaymentIntent(rpc,intent,'record');
 await vi.advanceTimersByTimeAsync(20001);expect(await pending).toEqual({status:'unknown'});
 expect(rpc).toHaveBeenCalledExactlyOnceWith('resolve_cashier_cash_buyin_intent_v1',{p_intent:intent,p_action:'record'});
});
