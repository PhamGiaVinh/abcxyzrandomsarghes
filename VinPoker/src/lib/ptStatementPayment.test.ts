import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearPtStatementPayment, loadPtStatementPayment, retainPtStatementPayment, submitPtStatementPayment, resolveSupersededPtPayment, type PtStatementPaymentIntent } from './ptStatementPayment';

const actor = '11111111-1111-4111-8111-111111111111', club = '22222222-2222-4222-8222-222222222222', dealer = '33333333-3333-4333-8333-333333333333';
const payment = '77777777-7777-4777-8777-777777777777';
const intent = (): PtStatementPaymentIntent => ({ actorId: actor, method: 'cash', reference: null,
  key: '66666666-6666-4666-8666-666666666666', statement: {
    statement_id: '44444444-4444-4444-8444-444444444444', request_id: '55555555-5555-4555-8555-555555555555',
    club_id: club, dealer_id: dealer, state: 'finalized', net_amount_vnd: 136792,
    finalized_at: '2026-10-31T03:00:00+07:00', payment_id: null, statement_hash: 'a'.repeat(64),
  } });
beforeEach(() => sessionStorage.clear());

const resolution=(i:PtStatementPaymentIntent)=>({resolution:'superseded_by_installments',actor_id:actor,
  statement_id:i.statement.statement_id,statement_hash:i.statement.statement_hash,club_id:club,dealer_id:dealer,
  intent_key:i.key,approved_amount_vnd:136792,legacy_payment_recorded:false,
  approval_request_id:'88888888-8888-4888-8888-888888888888'});
describe('superseded PT full-request resolution',()=>{
  it('archives the exact old intent with scoped server proof before clearing the active slot',async()=>{
    const i=retainPtStatementPayment(sessionStorage,intent()),proof=resolution(i);
    const rpc=vi.fn(async()=>({data:proof,error:null}));
    await expect(Promise.resolve().then(()=>resolveSupersededPtPayment(rpc,sessionStorage,i,()=>true))).resolves.toEqual(proof);
    expect(loadPtStatementPayment(sessionStorage,actor,club,dealer)).toBeNull();
    const archive=JSON.parse(sessionStorage.getItem(`vinpoker:pt-statement-payment-archive:v1:${actor}:${club}:${dealer}:${i.key}`)!);
    expect(archive).toEqual({version:1,intent:i,proof});
    expect(rpc.mock.calls).toEqual([['resolve_pt_full_payment_intent_v1',{
      p_statement_id:i.statement.statement_id,p_expected_hash:i.statement.statement_hash,p_intent_key:i.key}]]);
  });
  it.each(['actor_id','club_id','dealer_id','statement_id','statement_hash','intent_key','approved_amount_vnd','legacy_payment_recorded'] as const)(
    'preserves the old request if the server proof changes %s',async field=>{
      const i=retainPtStatementPayment(sessionStorage,intent());
      const proof={...resolution(i),[field]:field==='approved_amount_vnd'?1:field==='legacy_payment_recorded'?true:'99999999-9999-4999-8999-999999999999'};
      await expect(Promise.resolve().then(()=>resolveSupersededPtPayment(async()=>({data:proof,error:null}),sessionStorage,i,()=>true)))
        .rejects.toThrow('PT_PAYMENT_RESOLUTION_SCOPE_INVALID');
      expect(loadPtStatementPayment(sessionStorage,actor,club,dealer)).toEqual(i);expect(sessionStorage.length).toBe(1);
    });
  it('keeps the intent if the actor changes while the server response is pending',async()=>{
    const i=retainPtStatementPayment(sessionStorage,intent());let current=true;
    await expect(Promise.resolve().then(()=>resolveSupersededPtPayment(async()=>{
      current=false;return {data:resolution(i),error:null};
    },sessionStorage,i,()=>current))).rejects.toThrow('PT_PAYMENT_ACTOR_CHANGED');
    expect(loadPtStatementPayment(sessionStorage,actor,club,dealer)).toEqual(i);expect(sessionStorage.length).toBe(1);
  });
  it('does not discard the active request when saving its archive fails',async()=>{
    const i=retainPtStatementPayment(sessionStorage,intent());
    const storage={getItem:(key:string)=>sessionStorage.getItem(key),removeItem:(key:string)=>sessionStorage.removeItem(key),
      setItem:()=>{throw Error('storage unavailable');}};
    await expect(Promise.resolve().then(()=>resolveSupersededPtPayment(async()=>({data:resolution(i),error:null}),storage,i,()=>true)))
      .rejects.toThrow('storage unavailable');
    expect(loadPtStatementPayment(sessionStorage,actor,club,dealer)).toEqual(i);
  });
  it('does not archive or clear after a lost or refused server read',async()=>{
    const i=retainPtStatementPayment(sessionStorage,intent());
    await expect(Promise.resolve().then(()=>resolveSupersededPtPayment(async()=>{throw Error('lost');},sessionStorage,i,()=>true))).rejects.toThrow('lost');
    expect(loadPtStatementPayment(sessionStorage,actor,club,dealer)).toEqual(i);expect(sessionStorage.length).toBe(1);
  });
  it('retains the active intent if archive storage silently drops its write',async()=>{
    const i=retainPtStatementPayment(sessionStorage,intent());
    const storage={getItem:(key:string)=>sessionStorage.getItem(key),setItem:()=>{},removeItem:()=>{throw Error('must not clear');}};
    await expect(resolveSupersededPtPayment(async()=>({data:resolution(i),error:null}),storage,i,()=>true))
      .rejects.toThrow('PT_PAYMENT_STORAGE_UNAVAILABLE');
    expect(loadPtStatementPayment(sessionStorage,actor,club,dealer)).toEqual(i);
  });
  it('never clears a different active request that appears during the proof read',async()=>{
    const i=retainPtStatementPayment(sessionStorage,intent());
    const next={...i,key:'99999999-9999-4999-8999-999999999999'};
    await expect(resolveSupersededPtPayment(async()=>{
      clearPtStatementPayment(sessionStorage,i);retainPtStatementPayment(sessionStorage,next);
      return {data:resolution(i),error:null};
    },sessionStorage,i,()=>true)).rejects.toThrow('PT_PAYMENT_INTENT_CHANGED');
    expect(loadPtStatementPayment(sessionStorage,actor,club,dealer)).toEqual(next);
  });
  it('recovers an archive-save followed by failed active-slot removal without losing either proof',async()=>{
    const i=retainPtStatementPayment(sessionStorage,intent());let fail=true;
    const storage={getItem:(key:string)=>sessionStorage.getItem(key),setItem:(key:string,value:string)=>sessionStorage.setItem(key,value),
      removeItem:(key:string)=>{if(fail){fail=false;throw Error('remove unavailable');}sessionStorage.removeItem(key);}};
    const rpc=async()=>({data:resolution(i),error:null});
    await expect(resolveSupersededPtPayment(rpc,storage,i,()=>true)).rejects.toThrow('remove unavailable');
    expect(loadPtStatementPayment(sessionStorage,actor,club,dealer)).toEqual(i);
    expect(sessionStorage.length).toBe(2);
    await resolveSupersededPtPayment(rpc,storage,i,()=>true);
    expect(loadPtStatementPayment(sessionStorage,actor,club,dealer)).toBeNull();expect(sessionStorage.length).toBe(1);
  });
});
describe('finalized PT payment boundary', () => {
  it('stops an old retained full-payment intent when the server has adopted installments', async () => {
    const i=retainPtStatementPayment(sessionStorage,intent());
    const rpc=vi.fn(async()=>({data:{...i.statement,installments_adopted:true,paid_total_vnd:50000,remaining_vnd:86792},error:null}));
    await expect(submitPtStatementPayment(rpc,i,()=>true)).rejects.toThrow('PT_PAYMENT_MOVED_TO_INSTALLMENTS');
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(loadPtStatementPayment(sessionStorage,actor,club,dealer)?.key).toBe(i.key);
  });
  it('does not treat the final installment marker as a receipt for an old full-payment request',async()=>{
    const i=retainPtStatementPayment(sessionStorage,intent());
    const rpc=vi.fn(async()=>({data:{...i.statement,payment_id:payment,installments_adopted:true,
      paid_total_vnd:i.statement.net_amount_vnd,remaining_vnd:0},error:null}));
    await expect(submitPtStatementPayment(rpc,i,()=>true)).rejects.toThrow('PT_PAYMENT_MOVED_TO_INSTALLMENTS');
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(loadPtStatementPayment(sessionStorage,actor,club,dealer)?.key).toBe(i.key);
  });
  it('does not recover a full-payment request from installments adopted while its write waited',async()=>{
    const i=intent();let reads=0;
    const rpc=vi.fn(async(name:string)=>{
      if(name==='pay_finalized_part_time_payroll_statement') return {data:null,error:{code:'55000'}};
      return {data:++reads===1?i.statement:{...i.statement,payment_id:payment,installments_adopted:true,
        paid_total_vnd:i.statement.net_amount_vnd,remaining_vnd:0},error:null};
    });
    await expect(submitPtStatementPayment(rpc,i,()=>true)).rejects.toThrow('PT_PAYMENT_MOVED_TO_INSTALLMENTS');
    expect(rpc.mock.calls.filter(([name])=>name==='pay_finalized_part_time_payroll_statement')).toHaveLength(1);
  });
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
