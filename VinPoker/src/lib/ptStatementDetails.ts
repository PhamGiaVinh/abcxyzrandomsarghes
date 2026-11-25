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

const cursorSchema=z.object({finalized_at:z.string().datetime({offset:true}),statement_id:z.string().uuid()});
const historyRow=bindingSchema.extend({finalized_at:z.string().datetime({offset:true}),
  state:schema.shape.state,paid_total_vnd:money,remaining_vnd:money});
const historySchema=z.object({club_id:z.string().uuid(),dealer_id:z.string().uuid(),
  as_of:z.string().datetime({offset:true}),items:z.array(historyRow).max(20),next_cursor:cursorSchema.nullable()});
export type PtStatementCursor=z.infer<typeof cursorSchema>;
export type PtStatementHistory=z.infer<typeof historySchema>;
// PostgreSQL timestamps retain microseconds; Date.parse alone loses their order.
function timestampOrder(value:string):bigint {
  const fraction=value.match(/\.(\d+)/)?.[1]??'';
  return BigInt(Date.parse(value))*1000000n+BigInt(fraction.padEnd(9,'0').slice(3,9));
}

/** Check server totals and page identity; this does not calculate earned wages. */
export function parsePtStatementHistory(value:unknown,expected:{club_id:string;dealer_id:string},before:PtStatementCursor|null):PtStatementHistory {
  const page=historySchema.parse(value);
  if(page.club_id!==expected.club_id || page.dealer_id!==expected.dealer_id) throw Error('PT_HISTORY_SCOPE_INVALID');
  let prior=before;
  const ids=new Set<string>();
  for(const item of page.items) {
    const cancelled=['voided','replaced'].includes(item.state);
    if(item.club_id!==expected.club_id || item.dealer_id!==expected.dealer_id || ids.has(item.statement_id)
      || (cancelled ? item.paid_total_vnd!==0 || item.remaining_vnd!==0
        : BigInt(item.paid_total_vnd)+BigInt(item.remaining_vnd)!==BigInt(item.net_amount_vnd))) {
      throw Error('PT_HISTORY_FACTS_INVALID');
    }
    if(prior && (timestampOrder(item.finalized_at)>timestampOrder(prior.finalized_at)
      || (timestampOrder(item.finalized_at)===timestampOrder(prior.finalized_at) && item.statement_id>=prior.statement_id))) {
      throw Error('PT_HISTORY_ORDER_INVALID');
    }
    ids.add(item.statement_id);prior=item;
  }
  if(page.next_cursor && (page.items.length!==20 || !prior
    || page.next_cursor.statement_id!==prior.statement_id || page.next_cursor.finalized_at!==prior.finalized_at)) {
    throw Error('PT_HISTORY_CURSOR_INVALID');
  }
  return page;
}
