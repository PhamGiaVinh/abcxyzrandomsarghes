import { describe, expect, it } from "vitest";
import { createHistoricalCommitIntent, historicalCommitKey, historicalCommitReceiptState, historicalCommitResolutionState,
  persistHistoricalCommitJournal, readHistoricalCommitJournal, settleHistoricalCommitJournal } from "@/lib/tracker-poker/historicalCommitIntent";
const actor="81100000-0000-4000-8000-000000000001",tour="85000000-0000-4000-8000-000000000001",hand="86000000-0000-4000-8000-000000000001";
const make=()=>createHistoricalCommitIntent(actor,tour,{handId:hand,idempotencyKey:"history-test-request-0001",sourceRevision:1,
 sourceChainHash:"a".repeat(64),outcomeHash:"b".repeat(64),settlement:{schemaVersion:"settlement-outcome-v1",status:"verified",players:[],pots:[],refunds:[],handRanks:[]}});
function storage(){const values=new Map<string,string>();return {values,getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};}
describe("historical commit intent journal",()=>{
 it("accepts obsolete only from an exact serialized resolution with a strictly newer revision",()=>{
  const intent=make();const value={ok:true,status:"intent_obsolete",actor_id:actor,tournament_id:tour,hand_id:hand,
   idempotency_key:intent.idempotency_key,source_revision:1,source_chain_hash:intent.expected_source_chain_hash,
   outcome_hash:intent.expected_outcome_hash,current_source_revision:2,receipt:null};
  expect(historicalCommitResolutionState(value,intent)).toBe("obsolete");
  for(const patch of [{actor_id:"other"},{tournament_id:"other"},{hand_id:"other"},{idempotency_key:"other"},
   {source_revision:2},{source_chain_hash:"c".repeat(64)},{outcome_hash:"c".repeat(64)},
   {current_source_revision:1},{current_source_revision:null},{current_source_revision:2.5},{receipt:{}},{status:"receipt_not_found"}])
   expect(historicalCommitResolutionState({...value,...patch},intent)).toBeNull();
  expect(historicalCommitResolutionState({...value,status:"receipt_not_found",current_source_revision:1},intent)).toBe("not_found");
 });
 it("preserves exact metadata and rejects a replacement key or fingerprint",()=>{
  const s=storage(),intent=make();persistHistoricalCommitJournal(s,intent);expect(readHistoricalCommitJournal(s,intent)).toEqual(intent);
  expect(()=>persistHistoricalCommitJournal(s,{...intent,idempotency_key:"history-test-request-0002"})).toThrow(/CHANGED/);
  expect(()=>persistHistoricalCommitJournal(s,{...intent,expected_source_revision:2})).toThrow(/CHANGED/);
  settleHistoricalCommitJournal(s,intent);expect(s.values.size).toBe(0);
 });
 it("does not read another scope or silently replace corrupt metadata",()=>{
  const s=storage(),intent=make();persistHistoricalCommitJournal(s,intent);
  expect(readHistoricalCommitJournal(s,{...intent,expected_actor_id:"81300000-0000-4000-8000-000000000001"})).toBeNull();
  s.values.set(historicalCommitKey(intent),JSON.stringify({...intent,hand_id:"86000000-0000-4000-8000-000000000002"}));
  expect(()=>readHistoricalCommitJournal(s,intent)).toThrow(/INVALID/);expect(()=>settleHistoricalCommitJournal(s,intent)).toThrow();
 });
 it("requires exact terminal receipt metadata and never equates not-found with a failed write",()=>{
  const intent=make();const envelope={ok:true,status:"receipt_found",actor_id:actor,tournament_id:tour,hand_id:hand,
   idempotency_key:intent.idempotency_key,source_revision:1,source_chain_hash:intent.expected_source_chain_hash,outcome_hash:intent.expected_outcome_hash,
   receipt:{ok:true,idempotent:true,settlement_revision:1,source_revision:1,outcome_hash:intent.expected_outcome_hash}};
  expect(historicalCommitReceiptState(envelope,intent)).toBe("found");
  for(const patch of [{actor_id:"other"},{source_revision:2},{source_chain_hash:"c".repeat(64)},{idempotency_key:"other"},{receipt:{}}])
   expect(historicalCommitReceiptState({...envelope,...patch},intent)).toBeNull();
  expect(historicalCommitReceiptState({...envelope,status:"receipt_not_found",receipt:null},intent)).toBe("not_found");
  expect(historicalCommitReceiptState({...envelope,status:"receipt_not_found"},intent)).toBeNull();
 });
 it("cannot erase a later journal during cleanup",()=>{
  const s=storage(),intent=make();persistHistoricalCommitJournal(s,intent);
  const later={...intent,idempotency_key:"history-test-request-0002"};s.values.set(historicalCommitKey(intent),JSON.stringify(later));
  expect(()=>settleHistoricalCommitJournal(s,intent)).toThrow(/CHANGED/);expect(readHistoricalCommitJournal(s,later)).toEqual(later);
 });
});
