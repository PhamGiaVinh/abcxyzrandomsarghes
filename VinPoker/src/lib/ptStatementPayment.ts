import { z } from 'zod';
import { waitForManualPlayerResponse } from './floorManualPlayerIntent';

export const ptStatementReceiptSchema = z.object({
  statement_id: z.string().uuid(), request_id: z.string().uuid(), club_id: z.string().uuid(),
  dealer_id: z.string().uuid(), state: z.enum(['finalized', 'pdf_rendered', 'delivery_failed', 'sent', 'voided', 'replaced']),
  net_amount_vnd: z.number().int().nonnegative(), finalized_at: z.string().datetime({ offset: true }),
  payment_id: z.string().uuid().nullable(), statement_hash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type PtStatementReceipt = z.infer<typeof ptStatementReceiptSchema>;
const intentSchema = z.object({
  actorId: z.string().uuid(), statement: ptStatementReceiptSchema,
  method: z.enum(['cash', 'bank']), reference: z.string().trim().max(200).nullable(),
  key: z.string().uuid(),
}).strict().refine(x => x.statement.net_amount_vnd > 0 && x.statement.payment_id === null
  && !['voided', 'replaced'].includes(x.statement.state));
export type PtStatementPaymentIntent = z.infer<typeof intentSchema>;
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
const keyFor = (actor: string, club: string, dealer: string) => `vinpoker:pt-statement-payment:v1:${actor}:${club}:${dealer}`;

export function loadPtStatementPayment(storage: Storage, actor: string, club: string, dealer: string) {
  const raw = storage.getItem(keyFor(actor, club, dealer));
  if (raw === null) return null;
  const intent = intentSchema.parse(JSON.parse(raw));
  if (intent.actorId !== actor || intent.statement.club_id !== club || intent.statement.dealer_id !== dealer) {
    throw Error('PT_PAYMENT_SCOPE_INVALID');
  }
  return intent;
}

export function retainPtStatementPayment(storage: Storage, value: PtStatementPaymentIntent) {
  const intent = intentSchema.parse(value), s = intent.statement;
  const prior = loadPtStatementPayment(storage, intent.actorId, s.club_id, s.dealer_id);
  const serialized = JSON.stringify(intent);
  if (prior && JSON.stringify(prior) !== serialized) throw Error('PT_PAYMENT_INTENT_CHANGED');
  storage.setItem(keyFor(intent.actorId, s.club_id, s.dealer_id), serialized);
  if (storage.getItem(keyFor(intent.actorId, s.club_id, s.dealer_id)) !== serialized) throw Error('PT_PAYMENT_STORAGE_UNAVAILABLE');
  return intent;
}

export function clearPtStatementPayment(storage: Storage, intent: PtStatementPaymentIntent) {
  const s = intent.statement;
  if (JSON.stringify(loadPtStatementPayment(storage, intent.actorId, s.club_id, s.dealer_id)) !== JSON.stringify(intent)) {
    throw Error('PT_PAYMENT_INTENT_CHANGED');
  }
  const key = keyFor(intent.actorId, s.club_id, s.dealer_id);
  storage.removeItem(key);
  if (storage.getItem(key) !== null) throw Error('PT_PAYMENT_STORAGE_UNAVAILABLE');
}

/** A paid, same-hash statement is authoritative even when the write response was lost. */
export async function submitPtStatementPayment(rpc: Rpc, value: PtStatementPaymentIntent, isCurrent: () => boolean): Promise<PtStatementReceipt> {
  const intent = intentSchema.parse(value), expected = intent.statement;
  const read = async () => {
    if (!isCurrent()) throw Error('PT_PAYMENT_ACTOR_CHANGED');
    const result = await waitForManualPlayerResponse(Promise.resolve(rpc('get_part_time_payroll_statement_status_v1', {
      p_club_id: expected.club_id, p_dealer_id: expected.dealer_id, p_request_id: expected.request_id,
    })));
    if (result.error) throw result.error;
    const row = ptStatementReceiptSchema.parse(result.data);
    if (row.statement_id !== expected.statement_id || row.request_id !== expected.request_id
      || row.club_id !== expected.club_id || row.dealer_id !== expected.dealer_id
      || row.statement_hash !== expected.statement_hash || row.net_amount_vnd !== expected.net_amount_vnd
      || ['voided', 'replaced'].includes(row.state)) throw Error('PT_PAYMENT_STATEMENT_CHANGED');
    return row;
  };
  const before = await read();
  if (!isCurrent()) throw Error('PT_PAYMENT_ACTOR_CHANGED');
  if (before.payment_id) return before;
  let paymentId: string | null = null;
  let failure: unknown = null;
  try {
    const result = await waitForManualPlayerResponse(Promise.resolve(rpc('pay_finalized_part_time_payroll_statement', {
      p_statement_id: expected.statement_id, p_payment_method: intent.method,
      p_payment_reference: intent.reference, p_idempotency_key: intent.key,
      p_note: 'Ghi nhận chi theo phiếu PT đã chốt',
    })));
    if (result.error) throw result.error;
    const paid = z.object({ statement_id: z.string().uuid(), payment_id: z.string().uuid(), amount_vnd: z.number().int().nonnegative() }).parse(result.data);
    if (paid.statement_id !== expected.statement_id || paid.amount_vnd !== expected.net_amount_vnd) throw Error('PT_PAYMENT_RECEIPT_INVALID');
    paymentId = paid.payment_id;
  } catch (cause) { failure = cause; }
  const after = await read();
  if (!after.payment_id || (paymentId && paymentId !== after.payment_id)) throw failure ?? Error('PT_PAYMENT_UNVERIFIED');
  return after;
}
