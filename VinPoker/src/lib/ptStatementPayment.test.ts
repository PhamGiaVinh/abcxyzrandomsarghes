import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearPtStatementPayment, loadPtStatementPayment, retainPtStatementPayment, submitPtStatementPayment, type PtStatementPaymentIntent } from './ptStatementPayment';

const actor = '11111111-1111-4111-8111-111111111111', club = '22222222-2222-4222-8222-222222222222', dealer = '33333333-3333-4333-8333-333333333333';
const payment = '77777777-7777-4777-8777-777777777777';
const intent = (): PtStatementPaymentIntent => ({ actorId: actor, method: 'cash', reference: null,
  key: '66666666-6666-4666-8666-666666666666', statement: {
    statement_id: '44444444-4444-4444-8444-444444444444', request_id: '55555555-5555-4555-8555-555555555555',
    club_id: club, dealer_id: dealer, state: 'finalized', net_amount_vnd: 136792,
    finalized_at: '2026-10-31T03:00:00+07:00', payment_id: null, statement_hash: 'a'.repeat(64),
  } });
beforeEach(() => sessionStorage.clear());
describe('finalized PT payment boundary', () => {
  it('recovers a committed lost response from the same immutable statement without a second write', async () => {
    const i = retainPtStatementPayment(sessionStorage, intent()); let paid = false;
    const rpc = vi.fn(async (name: string) => {
      if (name === 'pay_finalized_part_time_payroll_statement') { paid = true; throw Error('lost'); }
      return { data: { ...i.statement, payment_id: paid ? payment : null }, error: null };
    });
    expect((await submitPtStatementPayment(rpc, i, () => true)).payment_id).toBe(payment);
    expect(rpc.mock.calls.filter(([name]) => name.startsWith('pay_'))).toHaveLength(1);
    expect(loadPtStatementPayment(sessionStorage, actor, club, dealer)?.key).toBe(i.key);
    clearPtStatementPayment(sessionStorage, i); expect(loadPtStatementPayment(sessionStorage, actor, club, dealer)).toBeNull();
  });
  it('reloads the exact saved intent and reconciles an already-paid statement with no mutation', async () => {
    const i = retainPtStatementPayment(sessionStorage, intent());
    const reloaded = loadPtStatementPayment(sessionStorage, actor, club, dealer)!;
    const rpc = vi.fn(async (..._args: [string, Record<string, unknown>]) => ({ data: { ...i.statement, payment_id: payment }, error: null }));
    await submitPtStatementPayment(rpc, reloaded, () => true);
    expect(rpc).toHaveBeenCalledTimes(1); expect(rpc.mock.calls[0][0]).toBe('get_part_time_payroll_statement_status_v1');
  });
  it.each(['club_id', 'dealer_id', 'statement_id', 'statement_hash', 'net_amount_vnd'] as const)('rejects changed %s before sending money', async field => {
    const i = intent(), changed = { ...i.statement, [field]: field === 'net_amount_vnd' ? 1 : field === 'statement_hash' ? 'b'.repeat(64) : payment };
    const rpc = vi.fn(async () => ({ data: changed, error: null }));
    await expect(submitPtStatementPayment(rpc, i, () => true)).rejects.toThrow(); expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('does not turn a failed receipt read into success or erase the saved request', async () => {
    const i = retainPtStatementPayment(sessionStorage, intent()); let reads = 0;
    const rpc = vi.fn(async (name: string) => {
      if (name === 'pay_finalized_part_time_payroll_statement') throw Error('lost');
      if (++reads > 1) throw Error('offline');
      return { data: i.statement, error: null };
    });
    await expect(submitPtStatementPayment(rpc, i, () => true)).rejects.toThrow();
    expect(loadPtStatementPayment(sessionStorage, actor, club, dealer)?.key).toBe(i.key);
  });
  it('stops after an actor/session scope is disposed during the source read', async () => {
    let current = true; const rpc = vi.fn(async () => { current = false; return { data: intent().statement, error: null }; });
    await expect(submitPtStatementPayment(rpc, intent(), () => current)).rejects.toThrow('PT_PAYMENT_ACTOR_CHANGED');
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('refuses replacing a retained intent or a zero/paid statement', () => {
    const i = retainPtStatementPayment(sessionStorage, intent());
    expect(() => retainPtStatementPayment(sessionStorage, { ...i, method: 'bank' })).toThrow('PT_PAYMENT_INTENT_CHANGED');
    expect(() => retainPtStatementPayment(sessionStorage, { ...i, statement: { ...i.statement, net_amount_vnd: 0 } })).toThrow();
    expect(() => retainPtStatementPayment(sessionStorage, { ...i, statement: { ...i.statement, payment_id: payment } })).toThrow();
  });
});
