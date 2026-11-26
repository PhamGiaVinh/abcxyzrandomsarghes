import {beforeEach,expect,it} from 'vitest';
import {cashierExpenseIntent,cashierExpenseKey,cashierExpenseLookup,cashierExpensePayload,cashierExpenseReadback,cashierExpenseResult,clearCashierExpenseIntent,loadCashierExpenseIntent,saveCashierExpenseIntent} from './cashierExpensePayment';
const actor='18140000-0000-4000-8000-000000000001',club='18140000-0000-4000-8000-000000000002',shift='18140000-0000-4000-8000-000000000003',request='18140000-0000-4000-8000-000000000004',expenseId='18140000-0000-4000-8000-000000000005';
const input={shiftId:shift,category:'rent',amountVnd:1000000,incurredAt:'2026-10-10T12:00:00+07:00',description:'TEST actual till source'};
const result={status:'ok',idempotent:false,expense_id:expenseId,request_id:request,shift_id:shift,amount_vnd:1000000,paid_at:'2026-11-26T01:00:00Z'};
const receipt={request_id:request,club_id:club,expense_id:expenseId,shift_id:shift,amount_vnd:1000000,paid_by:actor,paid_at:result.paid_at};
const expense={id:expenseId,club_id:club,category:'rent',amount_vnd:1000000,incurred_at:'2026-10-10T05:00:00Z',description:input.description,payment_status:'paid',payment_source:'cash',entered_by:actor,idempotency_key:'finance-cash-expense:'+request,tournament_id:null,series_id:null,attachment_url:null,adjusts_id:null};
beforeEach(()=>sessionStorage.clear());
it('persists and restores the exact selected source and request, separately from legacy records',()=>{
 const intent=cashierExpenseIntent(actor,club,input,request);saveCashierExpenseIntent(sessionStorage,intent);
 expect(loadCashierExpenseIntent(sessionStorage,actor,club)).toEqual(intent);expect(cashierExpenseKey(actor,club)).not.toBe(`vinpoker:expense-record:v1:${actor}:${club}`);
 expect(cashierExpensePayload(intent)).toEqual({p_request_id:request,p_club_id:club,p_shift_id:shift,p_category:'rent',p_amount_vnd:1000000,p_incurred_at:input.incurredAt,p_description:input.description,p_tournament_id:null,p_series_id:null,p_attachment_url:null});
});
it('never replaces or clears another pending payment',()=>{
 const first=cashierExpenseIntent(actor,club,input,request),other=cashierExpenseIntent(actor,club,{...input,amountVnd:2000000},expenseId);saveCashierExpenseIntent(sessionStorage,first);expect(()=>saveCashierExpenseIntent(sessionStorage,other)).toThrow();expect(()=>clearCashierExpenseIntent(sessionStorage,other)).toThrow();expect(loadCashierExpenseIntent(sessionStorage,actor,club)).toEqual(first);clearCashierExpenseIntent(sessionStorage,first);expect(loadCashierExpenseIntent(sessionStorage,actor,club)).toBeNull();
});
it('refuses corrupted and foreign-actor journal data without erasing it',()=>{
 const key=cashierExpenseKey(actor,club);sessionStorage.setItem(key,'broken');expect(()=>loadCashierExpenseIntent(sessionStorage,actor,club)).toThrow();expect(sessionStorage.getItem(key)).toBe('broken');const intent=cashierExpenseIntent(actor,club,input,request);sessionStorage.setItem(key,JSON.stringify({...intent,actorId:expenseId}));expect(()=>loadCashierExpenseIntent(sessionStorage,actor,club)).toThrow();
});
it('accepts only a server result matching the saved request, till, amount and full receipt shape',()=>{
 const intent=cashierExpenseIntent(actor,club,input,request);expect(cashierExpenseResult(intent,result)).toEqual(result);
 for(const patch of [{request_id:expenseId},{shift_id:expenseId},{amount_vnd:1},{expense_id:null},{paid_at:'bad'},{idempotent:'false'},{error:'NETWORK_ERROR'}])expect(cashierExpenseResult(intent,{...result,...patch})).toBeNull();
});
it('recovers a committed lost acknowledgement only from matching immutable receipt AND cost',()=>{
 const intent=cashierExpenseIntent(actor,club,input,request);expect(cashierExpenseReadback(intent,receipt,expense)).toEqual({...result,idempotent:true});
 for(const patch of [{club_id:expenseId},{paid_by:expenseId},{shift_id:expenseId},{amount_vnd:1}])expect(cashierExpenseReadback(intent,{...receipt,...patch},expense)).toBeNull();
 for(const patch of [{category:'misc'},{description:'other'},{incurred_at:'2026-10-10T05:00:00.000001Z'},{entered_by:expenseId},{payment_source:'bank'},{adjusts_id:expenseId},{idempotency_key:'other'}])expect(cashierExpenseReadback(intent,receipt,{...expense,...patch})).toBeNull();
 expect(cashierExpenseReadback(intent,null,expense)).toBeNull();
});
it.each([0,-1,1.5,Number.MAX_SAFE_INTEGER+1])('rejects a non-positive or unsafe funded expense amount %s',amountVnd=>{
 expect(()=>cashierExpenseIntent(actor,club,{...input,amountVnd},request)).toThrow();
});
it('resolves one atomic server snapshot, never treating missing authorization or open-source absence as rollback',()=>{
 const intent=cashierExpenseIntent(actor,club,input,request);
 const base={id:shift,club_id:club,closed_at:'2026-11-26T02:00:00Z',receipts:[],club:{id:club,expenses:[]}};
 expect(cashierExpenseLookup(intent,base)).toEqual({state:'not_committed'});
 for(const data of [null,{...base,closed_at:null},{...base,id:expenseId},{...base,club:null},{...base,club:{id:club,expenses:[{id:expenseId,club_id:club,idempotency_key:'finance-cash-expense:'+request}]}}])expect(cashierExpenseLookup(intent,data)).toEqual({state:'unresolved'});
 expect(cashierExpenseLookup(intent,{...base,receipts:[{...receipt,expense}],club:{id:club,expenses:[{id:expenseId,club_id:club,idempotency_key:'finance-cash-expense:'+request}]}})).toEqual({state:'committed',result:{...result,idempotent:true}});
});
