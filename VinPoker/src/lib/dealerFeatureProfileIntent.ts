import {z} from 'zod';
import {canonicalVoiceJson} from './trackerVoice/canonicalRequest';
const id=z.string().uuid();
const Scope=z.object({actorId:id,clubId:id,tableId:id,backend:z.string().min(1)}).strict();
const Profile=z.object({tableMode:z.enum(['normal','feature']),isFinal:z.boolean(),allowOverride:z.boolean(),
 pool:z.array(z.object({dealerId:id,isPrimary:z.boolean()}).strict()).refine(p=>new Set(p.map(m=>m.dealerId)).size===p.length)}).strict();
const Intent=Scope.extend({version:z.literal(1),requestId:id,profile:Profile}).strict();
const Journal=z.object({state:z.enum(['pending','settled']),intent:Intent}).strict();
export type DealerFeatureScope=z.infer<typeof Scope>;
export type DealerFeatureDraft=z.infer<typeof Profile>;
export type DealerFeatureIntent=z.infer<typeof Intent>;
type StorageIO=Pick<Storage,'getItem'|'setItem'>;
const scopeOf=(s:DealerFeatureScope)=>Scope.parse({actorId:s.actorId,clubId:s.clubId,tableId:s.tableId,backend:s.backend});
export function dealerFeatureBackend(value:string){
 const u=new URL(value);
 if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)throw Error('DEALER_PROFILE_BACKEND_INVALID');
 return u.href.replace(/\/$/,'');
}
export const dealerFeatureJournalKey=(s:DealerFeatureScope)=>`vinpoker:dealer-profile:v1:${encodeURIComponent(s.backend)}:${s.actorId}:${s.clubId}:${s.tableId}`;
export function readDealerFeatureJournal(storage:StorageIO,scope:DealerFeatureScope){
 const s=scopeOf(scope),raw=storage.getItem(dealerFeatureJournalKey(s));if(raw===null)return null;
 const j=Journal.parse(JSON.parse(raw));
 if(canonicalVoiceJson(scopeOf(j.intent))!==canonicalVoiceJson(s))throw Error('DEALER_PROFILE_JOURNAL_SCOPE_INVALID');
 return j;
}
export function retainDealerFeatureIntent(storage:StorageIO,scope:DealerFeatureScope,profile:DealerFeatureDraft){
 const s=Scope.parse(scope),p=Profile.parse(profile),previous=readDealerFeatureJournal(storage,s);
 if(previous?.state==='pending'){
  if(canonicalVoiceJson(previous.intent.profile)!==canonicalVoiceJson(p))throw Error('DEALER_PROFILE_INTENT_PENDING');
  return previous.intent;
 }
 const intent=Intent.parse({...s,profile:p,version:1,requestId:crypto.randomUUID()});
 const raw=JSON.stringify({state:'pending',intent});storage.setItem(dealerFeatureJournalKey(s),raw);
 if(storage.getItem(dealerFeatureJournalKey(s))!==raw)throw Error('DEALER_PROFILE_JOURNAL_WRITE_FAILED');return intent;
}
export function dealerFeatureArgs(intent:DealerFeatureIntent){
 const i=Intent.parse(intent);
 return {p_club_id:i.clubId,p_table_id:i.tableId,p_table_mode:i.profile.tableMode,p_is_final:i.profile.isFinal,
  p_allow_override:i.profile.allowOverride,p_members:i.profile.pool.map((m,priority)=>({dealer_id:m.dealerId,is_primary:m.isPrimary,priority})),p_request_id:i.requestId,p_expected_actor:i.actorId};
}
const Receipt=z.object({status:z.enum(['saved','cancelled']),actor_id:id,request_id:id,club_id:id,table_id:id,
 profile:z.object({table_mode:z.enum(['normal','feature']),is_final:z.boolean(),allow_override:z.boolean(),
  members:z.array(z.object({dealer_id:id,is_primary:z.boolean(),priority:z.number().int().nonnegative()}).strict())}).strict()}).strict();
export function matchDealerFeatureReceipt(value:unknown,intent:DealerFeatureIntent){
 const r=Receipt.parse(value),args=dealerFeatureArgs(intent);
 if(r.actor_id!==intent.actorId||r.request_id!==intent.requestId||r.club_id!==intent.clubId||r.table_id!==intent.tableId
  ||r.profile.table_mode!==args.p_table_mode||r.profile.is_final!==args.p_is_final||r.profile.allow_override!==args.p_allow_override
  ||canonicalVoiceJson(r.profile.members)!==canonicalVoiceJson(args.p_members))throw Error('DEALER_PROFILE_RECEIPT_INVALID');
 return r;
}
const ReadReceipt=z.discriminatedUnion('status',[
 z.object({status:z.literal('receipt_not_found'),actor_id:id}).strict(),
 z.object({status:z.literal('receipt_found'),actor_id:id,result:Receipt}).strict(),
]);
export function resolveDealerFeatureReceipt(value:unknown,intent:DealerFeatureIntent){
 const r=ReadReceipt.parse(value);if(r.actor_id!==intent.actorId)throw Error('DEALER_PROFILE_RECEIPT_ACTOR_INVALID');
 return r.status==='receipt_not_found'?{status:'missing' as const}:{status:'resolved' as const,receipt:matchDealerFeatureReceipt(r.result,intent)};
}
export function settleDealerFeatureIntent(storage:StorageIO,intent:DealerFeatureIntent,receipt:unknown){
 matchDealerFeatureReceipt(receipt,intent);
 const previous=readDealerFeatureJournal(storage,intent);
 if(!previous||canonicalVoiceJson(previous.intent)!==canonicalVoiceJson(intent))throw Error('DEALER_PROFILE_JOURNAL_CHANGED');
 const raw=JSON.stringify({state:'settled',intent});storage.setItem(dealerFeatureJournalKey(intent),raw);
 if(storage.getItem(dealerFeatureJournalKey(intent))!==raw)throw Error('DEALER_PROFILE_JOURNAL_SETTLE_FAILED');
}
