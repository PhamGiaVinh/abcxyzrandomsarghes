import {z} from 'zod';

const Scope=z.object({actorId:z.string().uuid(),clubId:z.string().uuid(),year:z.number().int(),month:z.number().int().min(1).max(12)}).strict();
const Intent=Scope.extend({version:z.literal(1),requestId:z.string().uuid()}).strict();
export type PayrollSaveScope=z.infer<typeof Scope>;
export type PayrollSaveIntent=z.infer<typeof Intent>;
const Base=z.object({ok:z.literal(true),requestId:z.string().uuid(),clubId:z.string().uuid(),year:z.number().int(),month:z.number().int().min(1).max(12)});
const Receipt=z.discriminatedUnion('outcome',[
 Base.extend({outcome:z.literal('saved'),periodId:z.string().uuid(),savedCount:z.number().int().nonnegative()}).strict(),
 Base.extend({outcome:z.literal('cancelled'),periodId:z.null(),savedCount:z.literal(0)}).strict(),
]);
export type PayrollSaveReceipt=z.infer<typeof Receipt>;
const key=(scope:PayrollSaveScope)=>`vinpoker:payroll-save:v1:${scope.actorId}:${scope.clubId}:${scope.year}:${scope.month}`;

export function parsePayrollSaveReceipt(value:unknown,intent:PayrollSaveIntent):PayrollSaveReceipt {
 const expected=Intent.parse(intent),receipt=Receipt.parse(value);
 if(receipt.requestId!==expected.requestId||receipt.clubId!==expected.clubId||receipt.year!==expected.year||receipt.month!==expected.month)
   throw new Error('PAYROLL_RECEIPT_SCOPE_INVALID');
 return receipt;
}
export function readPayrollSaveIntent(storage:Pick<Storage,'getItem'>,scope:PayrollSaveScope):PayrollSaveIntent|null {
 const expected=Scope.parse(scope),raw=storage.getItem(key(expected));
 if(raw===null)return null;
 const intent=Intent.parse(JSON.parse(raw));
 if(intent.actorId!==expected.actorId||intent.clubId!==expected.clubId||intent.year!==expected.year||intent.month!==expected.month)
   throw new Error('PAYROLL_INTENT_SCOPE_INVALID');
 return intent;
}
export function persistPayrollSaveIntent(storage:Pick<Storage,'getItem'|'setItem'>,scope:PayrollSaveScope):PayrollSaveIntent {
 const expected=Scope.parse(scope),existing=readPayrollSaveIntent(storage,expected);
 if(existing)return existing;
 const intent=Intent.parse({...expected,version:1,requestId:crypto.randomUUID()});
 const raw=JSON.stringify(intent);storage.setItem(key(expected),raw);
 if(storage.getItem(key(expected))!==raw)throw new Error('PAYROLL_INTENT_SAVE_FAILED');
 return intent;
}
export function clearPayrollSaveIntent(storage:Pick<Storage,'getItem'|'removeItem'>,intent:PayrollSaveIntent,receipt:unknown):void {
 const expected=Intent.parse(intent);parsePayrollSaveReceipt(receipt,expected);
 const scope=key(expected),raw=storage.getItem(scope);
 if(raw===null)return;
 if(raw!==JSON.stringify(expected))throw new Error('PAYROLL_INTENT_CHANGED');
 storage.removeItem(scope);
 if(storage.getItem(scope)!==null)throw new Error('PAYROLL_INTENT_CLEAR_FAILED');
}
