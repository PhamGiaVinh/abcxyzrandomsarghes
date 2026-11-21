import { describe, expect, it } from "vitest";
import { clearPrizePaymentIntent, persistPrizePaymentIntent, prizeDrawerRetryMessage, prizePaymentJournalKey, resolvePrizePaymentResult,parsePrizePaymentIntent,prizePaymentPayload,resolvePrizePaymentReceipt,
  type PrizePaymentIntent } from "./prizePaymentIntent";
const intent: PrizePaymentIntent = { actorId: "actor", tournamentId: "tour", requestId: "10000000-0000-4000-8000-000000000001",
  entryId: "10000000-0000-4000-8000-000000000002", recipientRef: "10000000-0000-4000-8000-000000000003",
  recipientName: "TEST", finishedPlace: 1, prizeAmount: 100, confirmationToken: "a".repeat(32), method: "cash" };
describe("payout recovery boundary", () => {
  it.each([
    ["55P03", "cash_prize_drawer_busy", "Két đang bận"],
    ["23514", "cash_prize_requires_open_shift", "Ca chưa mở két"],
    ["23514", "cash_prize_drawer_amount_unavailable", "Két không đủ tiền"],
  ])("explains the exact recoverable drawer error %s / %s", (code, message, label) => {
    const qualified = { ...intent, multiDayEventId: intent.entryId, multiDayParticipationId: intent.recipientRef };
    const error = { code, message };
    expect(prizeDrawerRetryMessage(qualified, error)).toEqual(expect.stringContaining(label));
    expect(prizeDrawerRetryMessage(qualified, error)).toEqual(expect.stringContaining("Gửi lại yêu cầu cũ"));
    expect(prizeDrawerRetryMessage({ ...intent, method: "cash" }, error)).toEqual(expect.stringContaining(label));
    expect(prizeDrawerRetryMessage({ ...qualified, method: "bank" }, error)).toBeNull();
    expect(prizeDrawerRetryMessage(qualified, { code: "XX000", message })).toBeNull();
    expect(resolvePrizePaymentResult(qualified, { ok: false, error: message })).toEqual({ status: "unknown" });
  });
  it.each(['payout_confirmation_stale','place_not_finalized','no_unpaid_obligation'])('retains established definitive rejection handling for %s',error=>{
    expect(resolvePrizePaymentResult(intent,{ok:false,error})).toEqual({status:'rejected',error});
  });
  it.each(['upstream_unavailable','unknown_payout_state','unrecognized_future_error'])('retains an unresolved request for unrecognized rejection %s',error=>{
    expect(resolvePrizePaymentResult(intent,{ok:false,error})).toEqual({status:'unknown'});
    expect(resolvePrizePaymentReceipt(intent,{found:true,actor_id:intent.actorId,request_id:intent.requestId,payload:prizePaymentPayload(intent),result:{ok:false,error}})).toEqual({status:'unknown'});
  });

  it.each([1.5,Number.MAX_SAFE_INTEGER+1])('rejects journal amount that cannot represent integer VND %s',amount=>{
    const invalid={...intent,prizeAmount:amount};
    expect(()=>parsePrizePaymentIntent(JSON.stringify(invalid),'actor','tour')).toThrow('PAYOUT_JOURNAL_INVALID');
  });
  it('binds multi-day recovery to the event and participation, never rank alone',()=>{
    const qualified={...intent,multiDayEventId:'10000000-0000-4000-8000-000000000010',multiDayParticipationId:'10000000-0000-4000-8000-000000000011'};
    expect(parsePrizePaymentIntent(JSON.stringify(qualified),'actor','tour')).toEqual(qualified);
    expect(()=>parsePrizePaymentIntent(JSON.stringify({...qualified,multiDayParticipationId:undefined}),'actor','tour')).toThrow();
    const receipt={found:true,actor_id:'actor',request_id:intent.requestId,payload:prizePaymentPayload(qualified),result:{
      ok:true,outcome:'recorded',payment_id:'10000000-0000-4000-8000-000000000012',paid_at:'2026-10-18T00:00:00Z',
      tournament_id:'tour',finished_place:1,entry_id:intent.entryId,recipient_ref:intent.recipientRef,prize_amount:100}};
    expect(resolvePrizePaymentReceipt(qualified,receipt)).toMatchObject({ status: 'committed', paymentId: receipt.result.payment_id });
    expect(resolvePrizePaymentReceipt(qualified,{...receipt,payload:{...receipt.payload,participation_id:intent.entryId}}).status).toBe('unknown');
  });
  it.each(["request_payload_conflict", "actor_not_allowed", "unauthorized"])(
    "preserves an unknown earlier result when server returns %s", (error) => {
      expect(resolvePrizePaymentResult(intent, { ok: false, error }).status).toBe("unknown");
    });
  it("does not replace a different unresolved intent", () => {
    sessionStorage.clear(); persistPrizePaymentIntent(sessionStorage, intent);
    expect(() => persistPrizePaymentIntent(sessionStorage, { ...intent, method: "bank" })).toThrow("PAYOUT_JOURNAL_PENDING");
    expect(() => clearPrizePaymentIntent(sessionStorage, { ...intent, method: "bank" })).toThrow("PAYOUT_JOURNAL_CHANGED");
    expect(sessionStorage.getItem(prizePaymentJournalKey(intent.actorId, intent.tournamentId))).toBe(JSON.stringify(intent));
  });
  it("allows clearing an already-resolved missing slot without erasing a new one", () => {
    sessionStorage.clear();
    expect(() => clearPrizePaymentIntent(sessionStorage, intent)).not.toThrow();
    persistPrizePaymentIntent(sessionStorage, { ...intent, method: "bank" });
    expect(() => clearPrizePaymentIntent(sessionStorage, intent)).toThrow("PAYOUT_JOURNAL_CHANGED");
  });
});
