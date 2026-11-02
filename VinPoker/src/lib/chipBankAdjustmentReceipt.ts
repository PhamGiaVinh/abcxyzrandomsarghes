import {z} from 'zod';

export interface ChipBankAdjustmentIntent {
 actorId:string;clubId:string;tournamentId:string|null;denominationId:string;
 direction:'thu'|'xuat';count:number;oldVersion:number;requestId:string;
}
const integer=z.number().int().safe();
const payloadSchema=z.object({club_id:z.string().min(1),denomination_id:z.string().min(1),direction:z.enum(['thu','xuat']),
 count:integer.positive(),tournament_id:z.string().min(1).nullable(),expected_version:integer.nonnegative()}).strict();
const receiptSchema=z.object({status:z.enum(['ok','rejected']),outcome:z.enum(['applied','rejected']),
 actor_id:z.string().min(1),request_id:z.string().min(1),payload:payloadSchema,ledger_id:z.string().uuid().nullable(),
 result:z.unknown(),error:z.string().min(1).nullable(),idempotent:z.boolean()}).strict();
const appliedSchema=z.object({status:z.literal('ok'),direction:z.enum(['thu','xuat']),count:integer.positive(),
 on_hand_count:integer.nonnegative(),balance_after:integer.nonnegative()}).strict();
const rejectedSchema=z.object({error:z.enum(['Unauthorized','Forbidden','INVALID_INPUT','DENOM_NOT_IN_CLUB','TOURNAMENT_NOT_IN_CLUB','BANK_NEGATIVE','race_lost']),
 on_hand:integer.nonnegative().optional(),actual_version:integer.nonnegative().optional()}).strict();

export function chipBankAdjustmentArgs(i:ChipBankAdjustmentIntent){
 return {p_club_id:i.clubId,p_denomination_id:i.denominationId,p_direction:i.direction,p_count:i.count,
  p_tournament_id:i.tournamentId,p_old_version:i.oldVersion,p_idempotency_key:i.requestId,p_expected_actor:i.actorId};
}
/** Unknown, conflicting or mis-scoped responses never authorize clearing an intent. */
export function parseChipBankAdjustmentReceipt(value:unknown,i:ChipBankAdjustmentIntent):
 {outcome:'applied';balanceAfter:number;ledgerId:string}|{outcome:'rejected';error:string}{
 const r=receiptSchema.parse(value),expected=payloadSchema.parse({club_id:i.clubId,denomination_id:i.denominationId,
  direction:i.direction,count:i.count,tournament_id:i.tournamentId,expected_version:i.oldVersion});
 if(r.actor_id!==i.actorId||r.request_id!==i.requestId||Object.entries(expected).some(([key,v])=>r.payload[key as keyof typeof expected]!==v))
  throw Error('CHIP_BANK_RECEIPT_SCOPE_INVALID');
 if(r.outcome==='applied'){
  const result=appliedSchema.parse(r.result);
  if(r.status!=='ok'||r.error!==null||!r.ledger_id||result.direction!==i.direction||result.count!==i.count||result.on_hand_count!==result.balance_after)
   throw Error('CHIP_BANK_RECEIPT_RESULT_INVALID');
  return {outcome:'applied',balanceAfter:result.balance_after,ledgerId:r.ledger_id};
 }
 const result=rejectedSchema.parse(r.result);
 if(r.status!=='rejected'||r.ledger_id!==null||r.error!==result.error)throw Error('CHIP_BANK_RECEIPT_REJECTION_INVALID');
 return {outcome:'rejected',error:result.error};
}
