import {beforeEach,expect,it} from 'vitest';
import {dealerFeatureArgs,dealerFeatureBackend,dealerFeatureJournalKey,matchDealerFeatureReceipt,readDealerFeatureJournal,
 retainDealerFeatureIntent,settleDealerFeatureIntent} from './dealerFeatureProfileIntent';
const scope={actorId:'febf2b51-fdb7-42ff-886c-b3bb1fffdc3e',clubId:'d4427834-5f5f-48ef-bde5-e2dc388ed00b',
 tableId:'e532db28-8841-48b0-8972-a9355f1dabe3',backend:'http://127.0.0.1:54329'};
const draft={tableMode:'normal' as const,isFinal:false,allowOverride:false,pool:[]};
const receipt=(i:ReturnType<typeof retainDealerFeatureIntent>)=>{const a=dealerFeatureArgs(i);return {status:'saved',actor_id:i.actorId,request_id:i.requestId,
 club_id:i.clubId,table_id:i.tableId,profile:{table_mode:a.p_table_mode,is_final:a.p_is_final,allow_override:a.p_allow_override,members:a.p_members}};};
beforeEach(()=>localStorage.clear());
it('retains exactly the same pending key through reload and rejects changed draft',()=>{
 const i=retainDealerFeatureIntent(localStorage,scope,draft);
 expect(retainDealerFeatureIntent(localStorage,scope,draft)).toEqual(i);
 expect(readDealerFeatureJournal(localStorage,scope)).toEqual({state:'pending',intent:i});
 expect(()=>retainDealerFeatureIntent(localStorage,scope,{...draft,isFinal:true})).toThrow('DEALER_PROFILE_INTENT_PENDING');
});
it('binds receipt identity and every operation field to the intent',()=>{
 const i=retainDealerFeatureIntent(localStorage,scope,draft),r=receipt(i);
 expect(matchDealerFeatureReceipt(r,i)).toEqual(r);
 for(const bad of [{...r,request_id:crypto.randomUUID()},{...r,table_id:crypto.randomUUID()},
  {...r,profile:{...r.profile,allow_override:true}},{...r,status:'ok'},null])expect(()=>matchDealerFeatureReceipt(bad,i)).toThrow();
});
it('settles only the exact journal after a valid receipt',()=>{
 const i=retainDealerFeatureIntent(localStorage,scope,draft),r=receipt(i);
 expect(()=>settleDealerFeatureIntent(localStorage,i,{...r,status:'unknown'})).toThrow();
 expect(readDealerFeatureJournal(localStorage,scope)?.state).toBe('pending');
 settleDealerFeatureIntent(localStorage,i,r);expect(readDealerFeatureJournal(localStorage,scope)?.state).toBe('settled');
 const newer=retainDealerFeatureIntent(localStorage,scope,{...draft,allowOverride:true});
 expect(()=>settleDealerFeatureIntent(localStorage,i,r)).toThrow('DEALER_PROFILE_JOURNAL_CHANGED');
 expect(readDealerFeatureJournal(localStorage,scope)?.intent).toEqual(newer);
});
it('rejects a journal copied across actor, club, table or backend',()=>{
 const i=retainDealerFeatureIntent(localStorage,scope,draft),raw=localStorage.getItem(dealerFeatureJournalKey(scope))!;
 for(const changed of [{...scope,actorId:crypto.randomUUID()},{...scope,clubId:crypto.randomUUID()},
  {...scope,tableId:crypto.randomUUID()},{...scope,backend:'https://example.invalid'}]){
  localStorage.setItem(dealerFeatureJournalKey(changed),raw);expect(()=>readDealerFeatureJournal(localStorage,changed)).toThrow();
 }
 expect(readDealerFeatureJournal(localStorage,scope)?.intent).toEqual(i);
});
it('does not accept malformed storage or unsafe endpoint identifiers',()=>{
 localStorage.setItem(dealerFeatureJournalKey(scope),'not json');expect(()=>readDealerFeatureJournal(localStorage,scope)).toThrow();
 expect(dealerFeatureBackend('http://127.0.0.1:54329/')).toBe(scope.backend);
 for(const url of ['https://user:secret@example.invalid/','https://example.invalid/?token=secret','file:///tmp/local'])expect(()=>dealerFeatureBackend(url)).toThrow();
});
it('sends the intended actor to the commit boundary and requires the same actor in a receipt',()=>{
 const i=retainDealerFeatureIntent(localStorage,scope,draft);
 expect(dealerFeatureArgs(i)).toHaveProperty('p_expected_actor',scope.actorId);
 expect(()=>matchDealerFeatureReceipt({...receipt(i),actor_id:crypto.randomUUID()},i)).toThrow();
 expect(()=>matchDealerFeatureReceipt({...receipt(i),actor_id:scope.actorId,status:'cancelled'},i)).not.toThrow();
});
