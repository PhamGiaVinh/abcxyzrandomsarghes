import {beforeEach,expect,it} from 'vitest';
import {clearRankingIntent,parseRankingIntent,parseRankingReceipt,parseRankingView,persistRankingIntent,rankingReviewKey,validRankingOrder,type RankingReviewIntent} from './tournamentRankingReview';
const id=(n:number)=>`fa861000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const scope={backendScope:'LOCAL861',actorId:id(1),tournamentId:id(2)};
const intent:RankingReviewIntent={...scope,requestId:id(3),sourceHash:'a'.repeat(32),orderedEntryIds:[id(10),id(12),id(11),id(13)]};
const row={tournament_id:scope.tournamentId,source_hash:intent.sourceHash,ordered_entry_ids:intent.orderedEntryIds,
 actor_id:scope.actorId,request_id:intent.requestId,created_at:'2026-10-26T00:00:00Z'};
const view=()=>({ok:true,review:null,source:{tournamentId:scope.tournamentId,sourceHash:intent.sourceHash,field:4,survivors:1,missingOrders:0,
 requiresReview:true,activeHand:false,evidencePending:false,hasOfficial:false,entries:[10,11,12,13].map((n,index)=>({entryId:id(n),playerId:id(n+20),entryNo:1,
 name:`TEST ${n}`,status:index?'busted':'registered',bustOrder:index?4-index:null,finishedPlace:null})),
 simultaneousHands:[id(40)],simultaneousGroups:[{handId:id(40),entryIds:[id(11),id(12)]}]}});
beforeEach(()=>sessionStorage.clear());
it('retains exact backend/actor/tournament intent and refuses replacement',()=>{
 persistRankingIntent(sessionStorage,intent);expect(parseRankingIntent(sessionStorage.getItem(rankingReviewKey(scope))!,scope)).toEqual(intent);
 expect(()=>persistRankingIntent(sessionStorage,{...intent,requestId:id(4)})).toThrow();
 for(const change of [{actorId:id(5)},{tournamentId:id(5)},{backendScope:'OTHER'}])expect(()=>parseRankingIntent(JSON.stringify(intent),{...scope,...change})).toThrow();
 clearRankingIntent(sessionStorage,intent);expect(sessionStorage.length).toBe(0);
});
it('will not erase a different or malformed journal',()=>{
 sessionStorage.setItem(rankingReviewKey(scope),'broken');expect(()=>clearRankingIntent(sessionStorage,intent)).toThrow();
 expect(sessionStorage.getItem(rankingReviewKey(scope))).toBe('broken');
});
it('accepts only swaps within the same group and preserves winner/unrelated slots',()=>{
 const parsed=parseRankingView(view(),scope.tournamentId);
 expect(validRankingOrder(parsed.source,intent.orderedEntryIds)).toBe(true);
 expect(validRankingOrder(parsed.source,[id(11),id(10),id(12),id(13)])).toBe(false);
 expect(validRankingOrder(parsed.source,[id(10),id(13),id(12),id(11)])).toBe(false);
 expect(validRankingOrder(parsed.source,[id(10),id(11),id(11),id(13)])).toBe(false);
});
it('rejects malformed or cross-tournament read data',()=>{
 expect(()=>parseRankingView(view(),id(9))).toThrow();
 const data=view();data.source.field=5;expect(()=>parseRankingView(data,scope.tournamentId)).toThrow();
 const duplicate=view();duplicate.source.entries[2]=duplicate.source.entries[1];expect(()=>parseRankingView(duplicate,scope.tournamentId)).toThrow();
});
it('rejects duplicated group identities rather than treating a missing group as verified',()=>{
 const data=view();data.source.simultaneousHands.push(id(41));data.source.simultaneousGroups.push(data.source.simultaneousGroups[0]);
 expect(()=>parseRankingView(data,scope.tournamentId)).toThrow();
});
it('distinguishes missing receipt from historical committed receipt without calling a writer',()=>{
 expect(parseRankingReceipt(intent,{ok:true,outcome:'not_found',review:null,sourceCurrent:false,currentSourceHash:'b'.repeat(32)},true)).toEqual({recorded:false,current:false});
 expect(parseRankingReceipt(intent,{ok:true,outcome:'recorded',review:row,sourceCurrent:false,currentSourceHash:'b'.repeat(32)},true)).toEqual({recorded:true,current:false});
 expect(parseRankingReceipt(intent,{ok:true,outcome:'recorded',review:row},false)).toEqual({recorded:true,current:true});
});
it('does not clear an intent for a mismatched or inconsistent receipt',()=>{
 for(const review of [{...row,actor_id:id(9)},{...row,request_id:id(9)},{...row,source_hash:'b'.repeat(32)},
  {...row,ordered_entry_ids:[id(10),id(11),id(12),id(13)]}])expect(()=>parseRankingReceipt(intent,{ok:true,outcome:'recorded',review},false)).toThrow();
 expect(()=>parseRankingReceipt(intent,{ok:true,outcome:'recorded',review:row,sourceCurrent:true,currentSourceHash:'b'.repeat(32)},true)).toThrow();
 expect(()=>parseRankingReceipt(intent,{ok:true,outcome:'not_found',review:null},true)).toThrow();
});
