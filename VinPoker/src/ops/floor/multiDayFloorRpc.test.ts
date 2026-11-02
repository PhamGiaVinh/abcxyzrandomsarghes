import {expect,it,vi} from 'vitest';
import type {OpsClient} from '@/ops/opsMutations';
import {callMultiDayFloorRpc} from './multiDayFloorRpc';
const args={p_event_id:'event',p_expected_rules_version:'rules',p_expected_funding_revision:'funding',
 p_expected_qualification_revision:'qualification',p_expected_payout_input_hash:'input',p_request_id:'request'};
const receipt={ok:true,state:'FINALIZED_OBLIGATIONS',eventId:'event',rulesVersion:'rules',fundingRevision:'funding',
 qualificationRevision:'qualification',payoutInputHash:'input',paymentExecution:'NOT_PERFORMED',idempotent:false};
it('does not accept ok-only as a successful prize-configuration write',async()=>{
 const client={rpc:vi.fn().mockResolvedValue({data:{ok:true},error:null})} as unknown as OpsClient;
 await expect(callMultiDayFloorRpc(client,'multi_day_save_prize_configuration_v1',{
  p_event_id:'10000000-0000-4000-8000-000000000001',p_rows:[{position:1,amount:100000}],
  p_expected_configuration_revision:'a'.repeat(32),p_expected_rules_version:'b'.repeat(32),p_expected_funding_revision:'c'.repeat(32),
  p_expected_qualification_revision:'d'.repeat(32),p_expected_payout_input_hash:'e'.repeat(32),
  p_request_id:'10000000-0000-4000-8000-000000000002',p_reason:'TEST verified proposal',
 })).rejects.toThrow('unverified');
});
it('validates explicit receipt absence and refuses another request or unrecognized recovery packet',async()=>{
 const lookup={p_event_id:'10000000-0000-4000-8000-000000000001',p_request_id:'10000000-0000-4000-8000-000000000002'};
 const absent={ok:true,state:'NOT_FOUND',eventId:lookup.p_event_id,requestId:lookup.p_request_id};
 const rpc=vi.fn().mockResolvedValue({data:absent,error:null}),client={rpc} as unknown as OpsClient;
 await expect(callMultiDayFloorRpc(client,'multi_day_prize_configuration_receipt_v1',lookup)).resolves.toEqual(absent);
 for(const bad of [null,{ok:true},{...absent,state:'SUCCESS'},{...absent,requestId:lookup.p_event_id}]){
  rpc.mockResolvedValueOnce({data:bad,error:null});
  await expect(callMultiDayFloorRpc(client,'multi_day_prize_configuration_receipt_v1',lookup)).rejects.toThrow('unverified');
 }
});
it('accepts only finalization for the exact event and revisions without executing payment',async()=>{
 const rpc=vi.fn().mockResolvedValue({data:receipt,error:null});
 const client={rpc} as unknown as OpsClient;
 await expect(callMultiDayFloorRpc(client,'multi_day_finalize_payout_v1',args)).resolves.toEqual(receipt);
 for(const invalid of [null,{ok:true},{...receipt,eventId:'other'},{...receipt,rulesVersion:'stale'},
  {...receipt,fundingRevision:'stale'},{...receipt,qualificationRevision:'stale'},
  {...receipt,payoutInputHash:'stale'},{...receipt,state:'READY'},{...receipt,paymentExecution:'PERFORMED'}]) {
  rpc.mockResolvedValueOnce({data:invalid,error:null});
  await expect(callMultiDayFloorRpc(client,'multi_day_finalize_payout_v1',args)).rejects.toThrow('unverified');
 }
});
it('does not treat ok-only or another operation outcome as rules, qualification or correction success',async()=>{
 const vectors=[
  {name:'multi_day_set_qualification_rules_v2',args:{p_day2_percent:20},result:{ok:true,idempotent:false,itmPercent:10,day2Percent:20}},
  {name:'multi_day_lock_qualification_v1',args:{p_event_id:'event',p_expected_source_hash:'source'},result:{ok:true,idempotent:false,eventId:'event',sourceHash:'source',finalTournamentId:'70000000-0000-0000-0000-000000000001',selectionHash:'a'.repeat(32),participationCount:8,policy:'SUM_STACKS',fundingState:'NOT_VERIFIED',seatingState:'HELD',payoutFinalization:'HELD'}},
  {name:'multi_day_request_payout_correction_v1',args:{p_request_id:'request'},result:{ok:true,idempotent:false,requestId:'request',state:'PENDING_APPROVAL'}},
  {name:'multi_day_approve_payout_correction_v1',args:{p_request_id:'request',p_approval_request_id:'approval'},result:{ok:true,idempotent:false,correctionId:'70000000-0000-0000-0000-000000000001',revision:'b'.repeat(32),paymentExecution:'NOT_PERFORMED'}},
 ];
 const rpc=vi.fn(),client={rpc} as unknown as OpsClient;
 for(const v of vectors) {
  rpc.mockResolvedValueOnce({data:v.result,error:null});
  await expect(callMultiDayFloorRpc(client,v.name,v.args)).resolves.toEqual(v.result);
  for(const bad of [null,{ok:true},{...v.result,ok:false},{...v.result,idempotent:'false'}]) {
   rpc.mockResolvedValueOnce({data:bad,error:null});
   await expect(callMultiDayFloorRpc(client,v.name,v.args)).rejects.toThrow('unverified');
  }
 }
});
it('validates current reversible payment identities, safe amounts and uniqueness without requiring new fields from an old backend',async()=>{
 const id='17d3392c-edb4-4e37-b16f-04e3c19d858a';
 const row={id,playerId:id,participationId:id,amountVnd:200000};
 const base={eventId:'event',revision:'a'.repeat(32),paidPlayerVnd:200000,unpaidObligationVnd:1400000,unallocatedPoolVnd:0};
 const rpc=vi.fn(),client={rpc} as unknown as OpsClient;
 for(const good of [base,{...base,reversiblePayments:[]},{...base,reversiblePayments:[row]}]){
  rpc.mockResolvedValueOnce({data:good,error:null});
  await expect(callMultiDayFloorRpc(client,'multi_day_payout_postfinal_state_v1',{p_event_id:'event'})).resolves.toEqual(good);
 }
 for(const rows of [null,{},[row,row],[{...row,id:'bad'}],[{...row,participationId:'bad'}],
  [{...row,amountVnd:null}],[{...row,amountVnd:-1}],[{...row,amountVnd:0}],[{...row,amountVnd:0.5}]]){
  rpc.mockResolvedValueOnce({data:{...base,reversiblePayments:rows},error:null});
  await expect(callMultiDayFloorRpc(client,'multi_day_payout_postfinal_state_v1',{p_event_id:'event'})).rejects.toThrow('unverified');
 }
});
