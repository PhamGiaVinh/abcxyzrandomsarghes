import type {PtStatementReceipt} from './ptStatementPayment';
import {z} from 'zod';
export type PtStatementBinding=Pick<PtStatementReceipt,'statement_id'|'statement_hash'|'club_id'|'dealer_id'|'net_amount_vnd'>;
const money=z.number().int().nonnegative().safe();
const bindingSchema=z.object({statement_id:z.string().uuid(),statement_hash:z.string().regex(/^[a-f0-9]{64}$/),
  club_id:z.string().uuid(),dealer_id:z.string().uuid(),net_amount_vnd:money});
const schema=z.object({statement_id:z.string().uuid(),statement_hash:z.string().regex(/^[a-f0-9]{64}$/),
  club_id:z.string().uuid(),dealer_id:z.string().uuid(),dealer_name:z.string().min(1),club_name:z.string().min(1),
  finalized_at:z.string().datetime({offset:true}),as_of:z.string().datetime({offset:true}),
  state:z.enum(['finalized','pdf_rendered','delivery_failed','sent','voided','replaced']),
  approved_amount_vnd:money,gross_amount_vnd:money,deduction_amount_vnd:money,paid_total_vnd:money,remaining_vnd:money,
  lines:z.array(z.object({line_no:z.number().int().positive(),label:z.string().min(1),quantity:z.number().finite().nonnegative().nullable(),
    unit:z.string().nullable(),unit_rate_vnd:money.nullable(),amount_vnd:z.number().int().safe()})),
  payments:z.array(z.object({payment_id:z.string().uuid(),amount_vnd:money.positive(),paid_at:z.string().datetime({offset:true}),
    payment_method:z.string().nullable(),payment_reference:z.string().nullable()})),
});
export type PtStatementDetails=z.infer<typeof schema>;

/** Validate scope and internally consistent server facts; never calculate a wage or payment. */
export function parsePtStatementDetails(value:unknown,expected:PtStatementBinding):PtStatementDetails {
  const binding=bindingSchema.parse(expected),row=schema.parse(value);
  if(row.statement_id!==binding.statement_id || row.statement_hash!==binding.statement_hash
    || row.club_id!==binding.club_id || row.dealer_id!==binding.dealer_id || row.approved_amount_vnd!==binding.net_amount_vnd) {
    throw Error('PT_STATEMENT_DETAILS_SCOPE_INVALID');
  }
  const paid=row.payments.reduce((total,p)=>total+BigInt(p.amount_vnd),0n);
  const cancelled=['voided','replaced'].includes(row.state);
  if(new Set(row.payments.map(p=>p.payment_id)).size!==row.payments.length
    || new Set(row.lines.map(l=>l.line_no)).size!==row.lines.length
    || paid!==BigInt(row.paid_total_vnd) || paid>BigInt(row.approved_amount_vnd)
    || BigInt(row.gross_amount_vnd)-BigInt(row.deduction_amount_vnd)!==BigInt(row.approved_amount_vnd)
    || (cancelled ? row.remaining_vnd!==0 || row.paid_total_vnd!==0
      : paid+BigInt(row.remaining_vnd)!==BigInt(row.approved_amount_vnd))) {
    throw Error('PT_STATEMENT_DETAILS_TOTALS_INVALID');
  }
  return row;
}
