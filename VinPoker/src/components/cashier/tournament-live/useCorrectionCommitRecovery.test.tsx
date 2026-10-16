import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCorrectionCommitRecovery } from "./useCorrectionCommitRecovery";
import { persistCorrectionIntent, readCorrectionIntent, type CorrectionCommitIntent } from "@/lib/tracker-poker/correctionCommitIntent";
const mock=vi.hoisted(()=>({actor:'81100000-0000-4000-8000-000000000001',invoke:vi.fn()}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:mock.actor}})}));
vi.mock('@/integrations/supabase/SupabaseClientContext',()=>({useSupabaseClient:()=>({functions:{invoke:mock.invoke}})}));
vi.mock('@/lib/tournament/observeTrackerContextRead',()=>({observeTrackerContextRead:<T,>(value:T)=>value}));
const intent:CorrectionCommitIntent={expected_actor_id:'81100000-0000-4000-8000-000000000001',tournament_id:'85000000-0000-4000-8000-000000000001',
 hand_id:'86000000-0000-4000-8000-000000000001',idempotency_key:'correction-request-0001',expected_source_revision:9,
 expected_source_chain_hash:'a'.repeat(64),expected_outcome_hash:'b'.repeat(64),expected_request_hash:'c'.repeat(64)};
const receipt=()=>({data:{ok:true,status:'receipt_found',actor_id:intent.expected_actor_id,tournament_id:intent.tournament_id,hand_id:intent.hand_id,
 idempotency_key:intent.idempotency_key,source_revision:9,source_chain_hash:intent.expected_source_chain_hash,outcome_hash:intent.expected_outcome_hash,
 request_hash:intent.expected_request_hash,current_source_revision:10,receipt:{ok:true,idempotent:true,settlement_revision:1,outcome_hash:intent.expected_outcome_hash}},error:null});
describe('correction recovery scope and mutation boundary',()=>{
 beforeEach(()=>{vi.useRealTimers();localStorage.clear();mock.actor=intent.expected_actor_id;mock.invoke.mockReset();
  Object.defineProperty(navigator,'locks',{configurable:true,value:{request:vi.fn(async(_key:unknown,_options:unknown,fn:()=>unknown)=>await fn())}});
 });
 it('persists before sending, blocks double-click and recovers after remount without mutation retry',async()=>{
  let finish!:(v:{data:unknown,error:unknown})=>void;
  const mutation=vi.fn(()=>new Promise<{data:unknown,error:unknown}>(resolve=>{finish=resolve;}));
  const resolved=vi.fn();const first=renderHook(()=>useCorrectionCommitRecovery(intent.tournament_id,intent.hand_id,resolved));
  let request!:Promise<boolean>;
  act(()=>{request=first.result.current.commit(intent,mutation);});
  await waitFor(()=>expect(mutation).toHaveBeenCalledTimes(1));expect(readCorrectionIntent(localStorage,intent)).toEqual(intent);
  await act(async()=>{expect(await first.result.current.commit(intent,mutation)).toBe(false);});
  await act(async()=>{finish({data:null,error:new Error('lost response')});expect(await request).toBe(false);});
  first.unmount();mock.invoke.mockResolvedValue(receipt());
  const second=renderHook(()=>useCorrectionCommitRecovery(intent.tournament_id,intent.hand_id,resolved));
  expect(second.result.current.message).toMatch(/chưa rõ/);
  await act(async()=>{await second.result.current.recover();});
  expect(mock.invoke).toHaveBeenCalledWith('tournament-live-resettle-commit',{body:{mode:'resolve',...intent}});
  expect(resolved).toHaveBeenCalledTimes(1);expect(readCorrectionIntent(localStorage,intent)).toBeNull();expect(mutation).toHaveBeenCalledTimes(1);
 });
 it('keeps not-found or malformed response unknown and never starts a replacement',async()=>{
  persistCorrectionIntent(localStorage,intent);mock.invoke.mockResolvedValue({data:{...receipt().data,status:'receipt_not_found',receipt:null},error:null});
  const resolved=vi.fn(),hook=renderHook(()=>useCorrectionCommitRecovery(intent.tournament_id,intent.hand_id,resolved));
  await act(async()=>{await hook.result.current.recover();});expect(resolved).not.toHaveBeenCalled();expect(readCorrectionIntent(localStorage,intent)).toEqual(intent);
  expect(()=>hook.result.current.assertNoPending()).toThrow();mock.invoke.mockResolvedValue({data:{ok:true},error:null});
  await act(async()=>{await hook.result.current.recover();});expect(readCorrectionIntent(localStorage,intent)).toEqual(intent);
 });
 it('ignores delayed receipt after account change and preserves the original actor journal',async()=>{
  persistCorrectionIntent(localStorage,intent);let finish!:(v:ReturnType<typeof receipt>)=>void;
  mock.invoke.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));const resolved=vi.fn();
  const hook=renderHook(()=>useCorrectionCommitRecovery(intent.tournament_id,intent.hand_id,resolved));let request!:Promise<void>;
  act(()=>{request=hook.result.current.recover();});mock.actor=crypto.randomUUID();hook.rerender();
  await act(async()=>{finish(receipt());await request;});expect(resolved).not.toHaveBeenCalled();expect(readCorrectionIntent(localStorage,intent)).toEqual(intent);expect(hook.result.current.message).toBeNull();
 });
 it('fails closed without browser lock support before sending',async()=>{
  Object.defineProperty(navigator,'locks',{configurable:true,value:undefined});const mutation=vi.fn();
  const hook=renderHook(()=>useCorrectionCommitRecovery(intent.tournament_id,intent.hand_id,vi.fn()));
  await expect(hook.result.current.commit(intent,mutation)).rejects.toThrow(/khóa/);expect(mutation).not.toHaveBeenCalled();expect(readCorrectionIntent(localStorage,intent)).toBeNull();
 });
 it('ends a hung mutation as unknown without dropping its durable identity',async()=>{
  vi.useFakeTimers();const mutation=vi.fn(()=>new Promise<{data:unknown,error:unknown}>(()=>{}));
  const hook=renderHook(()=>useCorrectionCommitRecovery(intent.tournament_id,intent.hand_id,vi.fn()));let request!:Promise<boolean>;
  await act(async()=>{request=hook.result.current.commit(intent,mutation);await Promise.resolve();});
  await act(async()=>{await vi.advanceTimersByTimeAsync(20_001);expect(await request).toBe(false);});
  expect(hook.result.current.busy).toBe(false);expect(readCorrectionIntent(localStorage,intent)).toEqual(intent);expect(mutation).toHaveBeenCalledTimes(1);vi.useRealTimers();
 });
 it('clears only an exact serialized obsolete proof, not a missing receipt',async()=>{
  persistCorrectionIntent(localStorage,intent);mock.invoke.mockResolvedValue({data:{...receipt().data,status:'intent_obsolete',receipt:null},error:null});
  const resolved=vi.fn(),hook=renderHook(()=>useCorrectionCommitRecovery(intent.tournament_id,intent.hand_id,resolved));
  await act(async()=>{await hook.result.current.recover();});expect(resolved).toHaveBeenCalledWith('obsolete');expect(readCorrectionIntent(localStorage,intent)).toBeNull();
 });
});
