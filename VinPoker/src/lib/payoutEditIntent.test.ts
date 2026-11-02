import {describe, expect, it} from 'vitest';
import {clearPayoutEditIntent, parsePayoutEditIntent, payoutEditArguments, payoutEditJournalKey,
  persistPayoutEditIntent, resolvePayoutEditReceipt, resolvePayoutEditResult, type PayoutEditIntent} from './payoutEditIntent';

const intent:PayoutEditIntent={actorId:'e7020000-0000-4000-8000-000000000001',
  tournamentId:'e7020000-0000-4000-8000-000000000002',requestId:'e7020000-0000-4000-8000-000000000003',
  expectedRunId:'e7020000-0000-4000-8000-000000000004',backend:'http://127.0.0.1:54329',
  pool:900000,rows:[{position:1,amount:700000},{position:2,amount:200000}],reason:'TEST correction'};
const parse=(value:unknown)=>parsePayoutEditIntent(JSON.stringify(value),intent.actorId,intent.tournamentId,intent.backend);
const result={status:'saved',actor_id:intent.actorId,tournament_id:intent.tournamentId,request_id:intent.requestId,
  previous_run_id:intent.expectedRunId,run_id:'e7020000-0000-4000-8000-000000000005',itm_places:2};
describe('payout manual intent boundaries',()=>{
  it('roundtrips only the complete exact scoped intent',()=>{
    expect(parse(intent)).toEqual(intent);
    expect(payoutEditArguments(intent).p_expected_actor).toBe(intent.actorId);
    for(const patch of [{actorId:result.run_id},{tournamentId:result.run_id},{backend:'http://localhost:54329'},
      {pool:900001},{reason:' '},{token:'never persist credentials'},
      {rows:[{position:1,amount:200000},{position:2,amount:700000}]}])expect(()=>parse({...intent,...patch})).toThrow();
  });
  it('isolates backend, actor and tournament journals and rejects credential-bearing URLs',()=>{
    const key=payoutEditJournalKey(intent.actorId,intent.tournamentId,intent.backend);
    expect(payoutEditJournalKey(result.run_id,intent.tournamentId,intent.backend)).not.toBe(key);
    expect(payoutEditJournalKey(intent.actorId,result.run_id,intent.backend)).not.toBe(key);
    expect(payoutEditJournalKey(intent.actorId,intent.tournamentId,'http://127.0.0.1:54330')).not.toBe(key);
    expect(()=>payoutEditJournalKey(intent.actorId,intent.tournamentId,'https://user:secret@example.com')).toThrow();
  });
  it('requires exact actor/request/run/result fields, not a generic saved acknowledgement',()=>{
    expect(resolvePayoutEditResult(intent,result)).toEqual({status:'saved',runId:result.run_id});
    for(const patch of [{actor_id:result.run_id},{request_id:result.run_id},{previous_run_id:result.run_id},
      {run_id:intent.expectedRunId},{itm_places:1}])expect(resolvePayoutEditResult(intent,{...result,...patch})).toEqual({status:'unknown'});
    expect(resolvePayoutEditResult(intent,{status:'saved'})).toEqual({status:'unknown'});
  });
  it('compares JSONB receipt payload structurally and rejects a changed payload',()=>{
    const receipt={status:'found',actor_id:intent.actorId,tournament_id:intent.tournamentId,request_id:intent.requestId,
      intent:{reason:intent.reason,rows:intent.rows.map(row=>({amount:row.amount,position:row.position})),
        expected_run_id:intent.expectedRunId,tournament_id:intent.tournamentId},result};
    expect(resolvePayoutEditReceipt(intent,receipt)).toEqual({status:'saved',runId:result.run_id});
    expect(resolvePayoutEditReceipt(intent,{...receipt,intent:{...receipt.intent,reason:'different'}})).toEqual({status:'unknown'});
  });
  it('does not overwrite or erase another tab intent',()=>{
    const map=new Map<string,string>();const storage={getItem:(key:string)=>map.get(key)??null,
      setItem:(key:string,value:string)=>{map.set(key,value);},removeItem:(key:string)=>{map.delete(key);}};
    persistPayoutEditIntent(storage,intent);persistPayoutEditIntent(storage,intent);
    const changed={...intent,requestId:result.run_id};
    expect(()=>persistPayoutEditIntent(storage,changed)).toThrow('PAYOUT_EDIT_JOURNAL_PENDING');
    expect(()=>clearPayoutEditIntent(storage,changed)).toThrow('PAYOUT_EDIT_JOURNAL_CHANGED');
    expect(map.size).toBe(1);clearPayoutEditIntent(storage,intent);expect(map.size).toBe(0);
  });
});
