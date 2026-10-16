import { describe, expect, it } from "vitest";
import { correctionCommitKey, correctionCommitConfirmed, correctionReceiptState, persistCorrectionIntent,
  readCorrectionIntent, settleCorrectionIntent, type CorrectionCommitIntent } from "@/lib/tracker-poker/correctionCommitIntent";
const intent: CorrectionCommitIntent = { expected_actor_id:"81100000-0000-4000-8000-000000000001", tournament_id:"85000000-0000-4000-8000-000000000001",
 hand_id:"86000000-0000-4000-8000-000000000001", idempotency_key:"correction-request-0001", expected_source_revision:9,
 expected_source_chain_hash:"a".repeat(64), expected_outcome_hash:"b".repeat(64), expected_request_hash:"c".repeat(64) };
function storage(){const map=new Map<string,string>();return {map,getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v);},removeItem:(k:string)=>{map.delete(k);}};}
describe("correction intent durability",()=>{
 it("retains the exact intent across reload, rejects replacement and protects later cleanup",()=>{
  const s=storage();persistCorrectionIntent(s,intent);expect(readCorrectionIntent(s,intent)).toEqual(intent);
  const changed={...intent,idempotency_key:"correction-request-0002"};expect(()=>persistCorrectionIntent(s,changed)).toThrow(/CHANGED/);
  s.map.set(correctionCommitKey(intent),JSON.stringify(changed));expect(()=>settleCorrectionIntent(s,intent)).toThrow(/CHANGED/);
  expect(readCorrectionIntent(s,changed)).toEqual(changed);
 });
 it("does not leak another actor journal or replace corrupt data",()=>{
  const s=storage();persistCorrectionIntent(s,intent);expect(readCorrectionIntent(s,{...intent,expected_actor_id:crypto.randomUUID()})).toBeNull();
  s.map.set(correctionCommitKey(intent),'broken');expect(()=>persistCorrectionIntent(s,intent)).toThrow();expect(s.map.get(correctionCommitKey(intent))).toBe('broken');
 });
 it("requires every receipt fingerprint and never treats not-found as failed commit",()=>{
  const envelope={ok:true,status:"receipt_found",actor_id:intent.expected_actor_id,tournament_id:intent.tournament_id,hand_id:intent.hand_id,
   idempotency_key:intent.idempotency_key,source_revision:9,source_chain_hash:intent.expected_source_chain_hash,outcome_hash:intent.expected_outcome_hash,
   request_hash:intent.expected_request_hash,receipt:{ok:true,idempotent:true,settlement_revision:1,outcome_hash:intent.expected_outcome_hash}};
  expect(correctionReceiptState(envelope,intent)).toBe('found');
  for(const patch of [{actor_id:'other'},{tournament_id:'other'},{hand_id:'other'},{idempotency_key:'other'},{source_revision:10},
   {source_chain_hash:'d'.repeat(64)},{outcome_hash:'e'.repeat(64)},{request_hash:'f'.repeat(64)},{receipt:null},{receipt:{ok:true}}])
   expect(correctionReceiptState({...envelope,...patch},intent)).toBeNull();
  expect(correctionReceiptState({...envelope,status:'receipt_not_found',receipt:null},intent)).toBe('not_found');
 });
 it("does not call missing or malformed commit receipts success",()=>{
  const good={ok:true,status:'verified',hand_id:intent.hand_id,receipt:{ok:true,correction_reason_recorded:true,settlement_revision:1,outcome_hash:intent.expected_outcome_hash}};
  expect(correctionCommitConfirmed(good,intent)).toBe(true);
  for(const receipt of [null,{}, {...good.receipt,ok:false},{...good.receipt,outcome_hash:'x'},{...good.receipt,settlement_revision:0},{...good.receipt,correction_reason_recorded:false}])
   expect(correctionCommitConfirmed({...good,receipt},intent)).toBe(false);
 });
 it("fails closed if durable storage cannot retain the intent",()=>{
  const s=storage();expect(()=>persistCorrectionIntent({...s,setItem:()=>{}},intent)).toThrow(/WRITE_FAILED/);expect(s.map.size).toBe(0);
 });
});
