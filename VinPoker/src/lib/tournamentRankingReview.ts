import {z} from 'zod';
const uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{32}$/);
const order=z.array(uuid).min(2).refine(ids=>new Set(ids).size===ids.length);
const receiptSchema=z.object({tournament_id:uuid,source_hash:hash,ordered_entry_ids:order,
 actor_id:uuid,request_id:uuid,created_at:z.string().refine(value=>Number.isFinite(Date.parse(value)))});
const entrySchema=z.object({entryId:uuid,playerId:uuid,entryNo:z.number().int().positive(),name:z.string().min(1),
 status:z.string().min(1),bustOrder:z.number().int().positive().nullable(),finishedPlace:z.number().int().positive().nullable()});
const sourceSchema=z.object({tournamentId:uuid,sourceHash:hash,field:z.number().int().nonnegative(),
 survivors:z.number().int().nonnegative(),missingOrders:z.number().int().nonnegative(),requiresReview:z.boolean(),
 activeHand:z.boolean(),evidencePending:z.boolean(),hasOfficial:z.boolean(),entries:z.array(entrySchema),
 simultaneousHands:z.array(uuid),simultaneousGroups:z.array(z.object({handId:uuid,entryIds:order}))});
const intentSchema=z.object({backendScope:z.string().min(1),actorId:uuid,tournamentId:uuid,requestId:uuid,
 sourceHash:hash,orderedEntryIds:order}).strict();
export type RankingReviewIntent=z.infer<typeof intentSchema>;
export type RankingReviewSource=z.infer<typeof sourceSchema>;
export type RankingReviewView={source:RankingReviewSource;review:z.infer<typeof receiptSchema>|null};
export type RankingReviewScope=Pick<RankingReviewIntent,'backendScope'|'actorId'|'tournamentId'>;
export const rankingReviewKey=(scope:RankingReviewScope)=>`vinpoker:ranking-review:v1:${JSON.stringify([scope.backendScope,scope.actorId,scope.tournamentId])}`;
export function parseRankingIntent(raw:string,scope:RankingReviewScope){
 const intent=intentSchema.parse(JSON.parse(raw));
 if(intent.backendScope!==scope.backendScope||intent.actorId!==scope.actorId||intent.tournamentId!==scope.tournamentId)throw Error('RANKING_INTENT_SCOPE_CONFLICT');
 return intent;
}
export function persistRankingIntent(storage:Pick<Storage,'getItem'|'setItem'>,intent:RankingReviewIntent){
 const key=rankingReviewKey(intent),raw=JSON.stringify(intentSchema.parse(intent)),old=storage.getItem(key);
 if(old!==null&&old!==raw)throw Error('RANKING_INTENT_PENDING');
 storage.setItem(key,raw);if(storage.getItem(key)!==raw)throw Error('RANKING_INTENT_SAVE_FAILED');
}
export function clearRankingIntent(storage:Pick<Storage,'getItem'|'removeItem'>,intent:RankingReviewIntent){
 const key=rankingReviewKey(intent),raw=JSON.stringify(intentSchema.parse(intent));
 if(storage.getItem(key)!==raw)throw Error('RANKING_INTENT_CHANGED');
 storage.removeItem(key);if(storage.getItem(key)!==null)throw Error('RANKING_INTENT_CLEAR_FAILED');
}
export function validRankingOrder(source:RankingReviewSource,ids:readonly string[]):boolean{
 if(ids.length!==source.entries.length||new Set(ids).size!==ids.length)return false;
 return ids.every((id,index)=>{
  const original=source.entries[index];
  return id===original.entryId||source.simultaneousGroups.some(group=>group.entryIds.includes(id)&&group.entryIds.includes(original.entryId));
 });
}
export function parseRankingView(value:unknown,tournamentId:string):RankingReviewView{
 const parsed=z.object({ok:z.literal(true),source:sourceSchema,review:receiptSchema.nullable()}).parse(value);
 const s=parsed.source,ids=new Set(s.entries.map(entry=>entry.entryId));
 if(s.tournamentId!==tournamentId||s.field!==s.entries.length||ids.size!==s.field
  ||s.survivors!==s.entries.filter(entry=>entry.status!=='busted').length
  ||s.simultaneousGroups.some(group=>group.entryIds.some(id=>!s.entries.some(entry=>entry.entryId===id&&entry.status==='busted')))
  ||s.requiresReview!==(s.simultaneousGroups.length>0)
  ||new Set(s.simultaneousHands).size!==s.simultaneousHands.length
  ||new Set(s.simultaneousGroups.map(group=>group.handId)).size!==s.simultaneousGroups.length
  ||s.simultaneousGroups.length!==s.simultaneousHands.length
  ||s.simultaneousGroups.some(group=>!s.simultaneousHands.includes(group.handId)))throw Error('RANKING_SOURCE_INVALID');
 if(parsed.review&&(parsed.review.tournament_id!==tournamentId||parsed.review.source_hash!==s.sourceHash
  ||!validRankingOrder(s,parsed.review.ordered_entry_ids)))throw Error('RANKING_REVIEW_INVALID');
 return {source:s,review:parsed.review};
}
export function parseRankingReceipt(intent:RankingReviewIntent,value:unknown,recovery:boolean){
 const response=z.object({ok:z.literal(true),outcome:z.enum(['recorded','not_found']),review:receiptSchema.nullable(),
  sourceCurrent:z.boolean().optional(),currentSourceHash:hash.optional()}).parse(value);
 if(recovery&&(response.sourceCurrent===undefined||!response.currentSourceHash))throw Error('RANKING_RECEIPT_INVALID');
 if(response.outcome==='not_found'){
  if(!recovery||response.review!==null||response.sourceCurrent!==false)throw Error('RANKING_RECEIPT_INVALID');
  return {recorded:false as const,current:false};
 }
 const r=response.review;
 if(!r||r.tournament_id!==intent.tournamentId||r.actor_id!==intent.actorId||r.request_id!==intent.requestId
  ||r.source_hash!==intent.sourceHash||JSON.stringify(r.ordered_entry_ids)!==JSON.stringify(intent.orderedEntryIds)
  ||(recovery&&response.sourceCurrent!==(response.currentSourceHash===intent.sourceHash)))throw Error('RANKING_RECEIPT_INVALID');
 return {recorded:true as const,current:recovery?response.sourceCurrent!:true};
}
