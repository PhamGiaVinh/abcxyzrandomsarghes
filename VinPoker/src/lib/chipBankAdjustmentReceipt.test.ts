import {describe,expect,it} from 'vitest';
import {chipBankAdjustmentArgs,parseChipBankAdjustmentReceipt,type ChipBankAdjustmentIntent} from './chipBankAdjustmentReceipt';
const intent:ChipBankAdjustmentIntent={actorId:'e2730000-0000-4000-8000-000000000001',clubId:'e2730000-0000-4000-8000-000000000010',
 tournamentId:'e2730000-0000-4000-8000-000000000020',denominationId:'e2730000-0000-4000-8000-000000000040',direction:'thu',count:12,oldVersion:3,requestId:'bank273-original'};
const receipt=()=>({status:'ok',outcome:'applied',actor_id:intent.actorId,request_id:intent.requestId,
 payload:{club_id:intent.clubId,denomination_id:intent.denominationId,tournament_id:intent.tournamentId,direction:intent.direction,count:12,expected_version:3},
 ledger_id:'e2730000-0000-4000-8000-000000000050',idempotent:false,error:null,
 result:{status:'ok',direction:'thu',count:12,on_hand_count:20,balance_after:20}});
describe('chip bank exact receipt boundary',()=>{
 it('builds the expected actor request and validates the committed ledger proof',()=>{
  expect(chipBankAdjustmentArgs(intent)).toMatchObject({p_expected_actor:intent.actorId,p_idempotency_key:intent.requestId,p_count:12,p_old_version:3});
  expect(parseChipBankAdjustmentReceipt(receipt(),intent)).toEqual({outcome:'applied',balanceAfter:20,ledgerId:'e2730000-0000-4000-8000-000000000050'});
 });
 it.each(['actor','key','club','tour','denom','direction','count','version','ledger','balance','on-hand','status','error','unsafe','unknown-field'])('rejects mismatched or invalid %s',kind=>{
  const r:Record<string,unknown>=structuredClone(receipt());
  const payload=r.payload as Record<string,unknown>,result=r.result as Record<string,unknown>;
  if(kind==='actor')r.actor_id='other';if(kind==='key')r.request_id='other';
  if(kind==='club')payload.club_id='other';if(kind==='tour')payload.tournament_id=null;
  if(kind==='denom')payload.denomination_id='other';if(kind==='direction')payload.direction='xuat';
  if(kind==='count')payload.count=13;if(kind==='version')payload.expected_version=4;
  if(kind==='ledger')r.ledger_id='not-ledger';if(kind==='balance')result.balance_after=-1;
  if(kind==='on-hand')result.on_hand_count=21;if(kind==='status')r.status='rejected';
  if(kind==='error')r.error='BANK_NEGATIVE';if(kind==='unsafe')result.balance_after=Number.MAX_SAFE_INTEGER+1;
  if(kind==='unknown-field')payload.extra=true;
  expect(()=>parseChipBankAdjustmentReceipt(r,intent)).toThrow();
 });
 it('accepts only matching, recognized, no-ledger rejected receipts',()=>{
  const r={...receipt(),status:'rejected',outcome:'rejected',ledger_id:null,error:'race_lost',result:{error:'race_lost',actual_version:4}};
  expect(parseChipBankAdjustmentReceipt(r,intent)).toEqual({outcome:'rejected',error:'race_lost'});
  expect(()=>parseChipBankAdjustmentReceipt({...r,error:'BANK_NEGATIVE'},intent)).toThrow();
  expect(()=>parseChipBankAdjustmentReceipt({...r,error:'UNRECOGNIZED',result:{error:'UNRECOGNIZED'}},intent)).toThrow();
  expect(()=>parseChipBankAdjustmentReceipt({...r,error:'IDEMPOTENCY_CONFLICT',result:{error:'IDEMPOTENCY_CONFLICT'}},intent)).toThrow();
  expect(()=>parseChipBankAdjustmentReceipt({...r,ledger_id:receipt().ledger_id},intent)).toThrow();
 });
});
