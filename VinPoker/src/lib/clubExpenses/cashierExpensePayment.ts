import {z} from 'zod';
import {EXPENSE_CATEGORIES,type ExpenseCategory} from './types';
const uuid=z.string().uuid();
const time=z.string().datetime({offset:true}).refine(value=>{
 const fraction=value.match(/\.(\d+)(?=Z|[+-]\d{2}:\d{2}$)/)?.[1];
 return Number.isFinite(Date.parse(value))&&(!fraction||fraction.length<=6);
});
const inputSchema=z.object({shiftId:uuid,category:z.enum(EXPENSE_CATEGORIES as [ExpenseCategory,...ExpenseCategory[]]),
 amountVnd:z.number().int().safe().positive(),incurredAt:time,description:z.string().nullable().default(null)}).strict();
const intentSchema=z.object({version:z.literal(1),actorId:uuid,clubId:uuid,requestId:uuid,input:inputSchema}).strict();
const resultSchema=z.object({status:z.literal('ok'),idempotent:z.boolean(),expense_id:uuid,request_id:uuid,
 shift_id:uuid,amount_vnd:z.number().int().safe().positive(),paid_at:time}).strict();
const receiptSchema=z.object({request_id:uuid,club_id:uuid,expense_id:uuid,shift_id:uuid,
 amount_vnd:z.number().int().safe().positive(),paid_by:uuid,paid_at:time}).strict();
const expenseSchema=z.object({id:uuid,club_id:uuid,category:inputSchema.shape.category,amount_vnd:z.number().int().safe().positive(),
 incurred_at:time,description:z.string().nullable(),payment_status:z.literal('paid'),payment_source:z.literal('cash'),
 entered_by:uuid,idempotency_key:z.string(),tournament_id:z.null(),series_id:z.null(),attachment_url:z.null(),adjusts_id:z.null()}).strict();
export type CashierExpenseInput=z.infer<typeof inputSchema>;
export type CashierExpenseIntent=z.infer<typeof intentSchema>;
export type CashierExpenseResult=z.infer<typeof resultSchema>;
export function cashierExpenseKey(actor:string,club:string){return `vinpoker:cashier-expense:v1:${actor}:${club}`;}
export function cashierExpenseIntent(actorId:string,clubId:string,input:unknown,requestId=crypto.randomUUID()):CashierExpenseIntent{
 return intentSchema.parse({version:1,actorId,clubId,requestId,input});
}
export function loadCashierExpenseIntent(storage:Pick<Storage,'getItem'>,actor:string,club:string):CashierExpenseIntent|null{
 const raw=storage.getItem(cashierExpenseKey(actor,club));if(raw===null)return null;
 const intent=intentSchema.parse(JSON.parse(raw));
 if(intent.actorId!==actor||intent.clubId!==club)throw Error('CASHIER_EXPENSE_JOURNAL_SCOPE');
 return intent;
}
export function saveCashierExpenseIntent(storage:Pick<Storage,'getItem'|'setItem'>,intent:CashierExpenseIntent):void{
 const checked=intentSchema.parse(intent),key=cashierExpenseKey(checked.actorId,checked.clubId),raw=JSON.stringify(checked);
 const current=storage.getItem(key);if(current!==null&&current!==raw)throw Error('CASHIER_EXPENSE_JOURNAL_PENDING');
 storage.setItem(key,raw);if(storage.getItem(key)!==raw)throw Error('CASHIER_EXPENSE_JOURNAL_SAVE_FAILED');
}
export function clearCashierExpenseIntent(storage:Pick<Storage,'getItem'|'removeItem'>,intent:CashierExpenseIntent):void{
 const key=cashierExpenseKey(intent.actorId,intent.clubId),current=storage.getItem(key);
 if(current===null)return;
 if(current!==JSON.stringify(intent))throw Error('CASHIER_EXPENSE_JOURNAL_CHANGED');
 storage.removeItem(key);if(storage.getItem(key)!==null)throw Error('CASHIER_EXPENSE_JOURNAL_CLEAR_FAILED');
}
export function cashierExpensePayload(intent:CashierExpenseIntent){
 const {input}=intent;
 return {p_request_id:intent.requestId,p_club_id:intent.clubId,p_shift_id:input.shiftId,p_category:input.category,
  p_amount_vnd:input.amountVnd,p_incurred_at:input.incurredAt,p_description:input.description,
  p_tournament_id:null,p_series_id:null,p_attachment_url:null};
}
export function cashierExpenseResult(intent:CashierExpenseIntent,data:unknown):CashierExpenseResult|null{
 const parsed=resultSchema.safeParse(data);if(!parsed.success)return null;const result=parsed.data;
 return result.request_id===intent.requestId&&result.shift_id===intent.input.shiftId&&result.amount_vnd===intent.input.amountVnd?result:null;
}
function instant(value:string):bigint{
 const fraction=value.match(/\.(\d+)(?=Z|[+-]\d{2}:\d{2}$)/)?.[1]??'';
 return BigInt(Date.parse(value))*1000n+BigInt(fraction.padEnd(6,'0').slice(3));
}
export function cashierExpenseReadback(intent:CashierExpenseIntent,receipt:unknown,expense:unknown):CashierExpenseResult|null{
 const r=receiptSchema.safeParse(receipt),e=expenseSchema.safeParse(expense);if(!r.success||!e.success)return null;
 const row=r.data,cost=e.data,input=intent.input;
 if(row.request_id!==intent.requestId||row.club_id!==intent.clubId||row.paid_by!==intent.actorId
  ||row.shift_id!==input.shiftId||row.amount_vnd!==input.amountVnd||cost.id!==row.expense_id||cost.club_id!==intent.clubId
  ||cost.category!==input.category||cost.amount_vnd!==input.amountVnd||instant(cost.incurred_at)!==instant(input.incurredAt)
  ||cost.description!==input.description||cost.entered_by!==intent.actorId||cost.idempotency_key!=='finance-cash-expense:'+intent.requestId)return null;
 return {status:'ok',idempotent:true,expense_id:row.expense_id,request_id:row.request_id,
  shift_id:row.shift_id,amount_vnd:row.amount_vnd,paid_at:row.paid_at};
}
const lookupSchema=z.object({id:uuid,club_id:uuid,closed_at:time.nullable(),
 receipts:z.array(receiptSchema.extend({expense:expenseSchema.nullable()})).max(1),
 club:z.object({id:uuid,expenses:z.array(z.object({id:uuid,club_id:uuid,idempotency_key:z.string()}).strict()).max(1)}).strict(),
}).strict();
export type CashierExpenseLookup={state:'unresolved'}|{state:'not_committed'}|{state:'committed';result:CashierExpenseResult};
export const CASHIER_EXPENSE_LOOKUP_SELECT='id,club_id,closed_at,receipts:finance_expense_cash_receipts(request_id,club_id,expense_id,shift_id,amount_vnd,paid_by,paid_at,expense:club_expenses(id,club_id,category,amount_vnd,incurred_at,description,payment_status,payment_source,entered_by,idempotency_key,tournament_id,series_id,attachment_url,adjusts_id)),club:clubs!cashier_till_shifts_club_id_fkey(id,expenses:club_expenses(id,club_id,idempotency_key))';
export function cashierExpenseLookup(intent:CashierExpenseIntent,data:unknown):CashierExpenseLookup{
 const parsed=lookupSchema.safeParse(data);if(!parsed.success)return {state:'unresolved'};
 const row=parsed.data;
 if(row.id!==intent.input.shiftId||row.club_id!==intent.clubId||row.club.id!==intent.clubId
  ||row.club.expenses.some(e=>e.club_id!==intent.clubId||e.idempotency_key!=='finance-cash-expense:'+intent.requestId))return {state:'unresolved'};
 if(row.receipts.length){
  const {expense,...receipt}=row.receipts[0],result=cashierExpenseReadback(intent,receipt,expense);
  return result?{state:'committed',result}:{state:'unresolved'};
 }
 // One database snapshot, not separate "receipt missing" then "till closed" reads.
 // The pinned till RLS requires is_club_cashier, which also grants receipt/cost
 // visibility. Closed-source absence is conclusive only with both embeds present.
 // Legacy cost with the same key remains unresolved; never recreate that cost.
 return row.closed_at!==null&&row.club.expenses.length===0?{state:'not_committed'}:{state:'unresolved'};
}
